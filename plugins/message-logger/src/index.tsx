/*
 * Mobile adaptation of Vencord's MessageLogger
 * (original authors: rushii, Ven, AutumnVN, Nickyux, Kyuuhachi, sadan).
 * Vencord is GPL-3.0-or-later; this port is distributed under the same terms.
 *
 * Desktop renders ghost messages inline via webpack patches. React Native has
 * no equivalent hook points, so this port keeps a local log instead: message
 * snapshots are cached from flux events, and deletions/edits are recorded
 * into a viewer with copy-back. Nothing leaves your device.
 */

import { findByStoreName } from "@vendetta/metro";
import { FluxDispatcher, React, ReactNative, clipboard } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { showConfirmationAlert } from "@vendetta/ui/alerts";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

storage.logDeletes ??= true;
storage.logEdits ??= true;
storage.ignoreBots ??= true;
storage.ignoreSelf ??= false;
storage.ignoreUsers ??= "";
storage.ignoreChannels ??= "";
storage.ignoreGuilds ??= "";
storage.cache ??= {};
storage.log ??= [];

const { ScrollView, Text } = ReactNative;
const { FormSection, FormRow, FormSwitchRow, FormInput } = Forms;

const CACHE_CAP = 1000;
const LOG_CAP = 200;

interface Snap {
	id: string;
	channelId: string;
	authorId: string;
	authorName: string;
	bot: boolean;
	content: string;
	at: number;
}

interface LogEntry extends Snap {
	kind: "deleted" | "edited";
	oldContent?: string;
	loggedAt: number;
}

let subscribed = false;
const unsubs: (() => void)[] = [];

// The snapshot cache is ephemeral: keep a working copy in memory and flush
// to storage periodically (every message would otherwise re-serialize up to
// 1000 snapshots). The log itself persists immediately; it is the valuable
// data and stays small.
let memCache: Record<string, Snap> | null = null;
let cacheWrites = 0;

function getCache(): Record<string, Snap> {
	if (!memCache) memCache = { ...readCache() };
	return memCache;
}

function saveCache(force = false) {
	if (!memCache) return;
	cacheWrites++;
	if (!force && cacheWrites % 25 !== 0) return;
	writeCache({ ...memCache });
}

function readCache(): Record<string, Snap> {
	const c = storage.cache as Record<string, Snap> | undefined;
	return c && typeof c === "object" ? c : {};
}

function readLog(): LogEntry[] {
	return Array.isArray(storage.log) ? storage.log as LogEntry[] : [];
}

function writeCache(c: Record<string, Snap>) {
	const ids = Object.keys(c);
	if (ids.length > CACHE_CAP) {
		for (const id of ids.slice(0, ids.length - CACHE_CAP)) delete c[id];
	}
	storage.cache = c;
}

function pushLog(e: LogEntry) {
	storage.log = [e, ...readLog()].slice(0, LOG_CAP);
}

function myId(): string {
	try {
		return findByStoreName("UserStore")?.getCurrentUser?.()?.id ?? "";
	} catch {
		return "";
	}
}

function guildOf(channelId: string): string {
	try {
		return findByStoreName("ChannelStore")?.getChannel?.(channelId)?.guild_id ?? "";
	} catch {
		return "";
	}
}

function listIncludes(csv: unknown, v: string): boolean {
	if (typeof csv !== "string" || !v) return false;
	return csv.split(",").map(s => s.trim()).filter(Boolean).includes(v);
}

function shouldIgnore(msg: { author?: any; channel_id?: string; }, isEdit: boolean): boolean {
	try {
		if (isEdit ? !storage.logEdits : !storage.logDeletes) return true;
		const authorId = String(msg?.author?.id ?? "");
		if (storage.ignoreBots && msg?.author?.bot) return true;
		if (storage.ignoreSelf && authorId && authorId === myId()) return true;
		if (listIncludes(storage.ignoreUsers, authorId)) return true;
		const ch = String(msg?.channel_id ?? "");
		if (listIncludes(storage.ignoreChannels, ch)) return true;
		if (listIncludes(storage.ignoreGuilds, guildOf(ch))) return true;
		return false;
	} catch {
		return false;
	}
}

function snapOf(m: any): Snap | null {
	try {
		if (!m?.id || !m?.channel_id) return null;
		return {
			id: String(m.id),
			channelId: String(m.channel_id),
			authorId: String(m.author?.id ?? ""),
			authorName: String(m.author?.global_name || m.author?.username || "unknown"),
			bot: !!m.author?.bot,
			content: String(m.content ?? ""),
			at: Date.now(),
		};
	} catch {
		return null;
	}
}

function onCreate(e: any) {
	try {
		const s = snapOf(e?.message);
		if (!s || shouldIgnore(e.message, false)) return;
		getCache()[s.id] = s;
		saveCache();
	} catch { /* never break the flux pipeline */ }
}

function onUpdate(e: any) {
	try {
		const m = e?.message;
		if (!m?.id || !m?.edited_timestamp) return;
		if (shouldIgnore(m, true)) return;
		const c = getCache();
		const old = c[String(m.id)];
		const next = snapOf(m);
		if (next) {
			c[next.id] = next;
			saveCache();
		}
		if (old && typeof m.content === "string" && m.content !== old.content) {
			pushLog({ ...(next ?? old), kind: "edited", oldContent: old.content, loggedAt: Date.now() });
		}
	} catch { /* never break the flux pipeline */ }
}

function onDelete(channelId: string, id: string) {
	try {
		if (!id) return;
		const c = getCache();
		const s = c[String(id)];
		if (!s) return;
		delete c[s.id];
		saveCache();
		if (shouldIgnore({ author: { id: s.authorId, bot: s.bot }, channel_id: channelId || s.channelId }, false)) return;
		if (!storage.logDeletes) return;
		pushLog({ ...s, channelId: channelId || s.channelId, kind: "deleted", loggedAt: Date.now() });
	} catch { /* never break the flux pipeline */ }
}

function subscribeFlux(): boolean {
	try {
		const FD = FluxDispatcher as any;
		if (!FD || typeof FD.subscribe !== "function") return false;
		const mk = (type: string, fn: (e: any) => void) => {
			FD.subscribe(type, fn);
			unsubs.push(() => {
				try { FD.unsubscribe(type, fn); } catch { }
			});
		};
		mk("MESSAGE_CREATE", onCreate);
		mk("MESSAGE_UPDATE", onUpdate);
		mk("MESSAGE_DELETE", (e: any) => onDelete(String(e?.channelId ?? ""), String(e?.id ?? "")));
		mk("MESSAGE_DELETE_BULK", (e: any) => {
			const ch = String(e?.channelId ?? "");
			for (const id of (e?.ids ?? [])) onDelete(ch, String(id));
		});
		return true;
	} catch {
		return false;
	}
}

function fmtTime(at: number): string {
	try {
		return new Date(at).toLocaleString();
	} catch {
		return "";
	}
}

function Settings() {
	useProxy(storage);
	const log = readLog();
	const deleted = log.filter(e => e.kind === "deleted");
	const edited = log.filter(e => e.kind === "edited");

	function copy(text: string, what: string) {
		try {
			clipboard.setString(text);
			showToast(`${what} copied to clipboard`);
		} catch {
			showToast("Copy failed");
		}
	}

	function clearLog() {
		const doClear = () => {
			storage.log = [];
			storage.cache = {};
			memCache = null;
			showToast("Message log cleared");
		};
		try {
			showConfirmationAlert({
				title: "Clear message log?",
				content: "This deletes all locally logged deletions and edits.",
				confirmText: "Delete",
				cancelText: "Cancel",
				onConfirm: doClear,
			});
		} catch {
			doClear();
		}
	}

	const row = (e: LogEntry) => (
		<FormRow
			key={`${e.kind}-${e.id}-${e.loggedAt}`}
			label={`${e.authorName} - #${e.channelId.slice(-6)}`}
			subLabel={`${fmtTime(e.loggedAt)} - ${(e.kind === "edited" ? (e.oldContent ?? "") : e.content).slice(0, 120) || "(no text)"}`}
			onPress={() => copy(e.kind === "edited" ? `Before: ${e.oldContent ?? ""}\nAfter: ${e.content}` : e.content, "Logged message")}
		/>
	);

	return (
		<ScrollView style={{ flex: 1 }}>
			<FormSection title="Message logger">
				<FormRow
					label="Hook status"
					subLabel={subscribed
						? "Listening for deletes and edits."
						: "Flux hook unavailable on this Discord version; logging is disabled."}
				/>
				<FormSwitchRow
					label="Log deleted messages"
					value={!!storage.logDeletes}
					onValueChange={v => { storage.logDeletes = v; }}
				/>
				<FormSwitchRow
					label="Log edited messages"
					subLabel="Keeps the before/after text"
					value={!!storage.logEdits}
					onValueChange={v => { storage.logEdits = v; }}
				/>
				{log.length > 0 && (
					<FormRow label="Clear log" subLabel={`${log.length} entr(ies) stored on this device`} onPress={clearLog} />
				)}
				<Text style={{ opacity: 0.7, marginHorizontal: 12, marginVertical: 6 }}>
					Logged messages stay on this device. Tap any entry to copy it.
				</Text>
			</FormSection>
			{deleted.length > 0 && (
				<FormSection title={`Deleted (${deleted.length})`}>
					{deleted.slice(0, 100).map(row)}
				</FormSection>
			)}
			{edited.length > 0 && (
				<FormSection title={`Edited (${edited.length})`}>
					{edited.slice(0, 100).map(row)}
				</FormSection>
			)}
			<FormSection title="Ignore">
				<FormSwitchRow
					label="Ignore bots"
					value={!!storage.ignoreBots}
					onValueChange={v => { storage.ignoreBots = v; }}
				/>
				<FormSwitchRow
					label="Ignore yourself"
					value={!!storage.ignoreSelf}
					onValueChange={v => { storage.ignoreSelf = v; }}
				/>
				<Text style={{ opacity: 0.7, marginHorizontal: 12, marginBottom: 4 }}>
					Comma-separated user IDs to ignore
				</Text>
				<FormInput title="" placeholder="123, 456" value={String(storage.ignoreUsers ?? "")} onChange={(v: string) => { storage.ignoreUsers = v; }} />
				<Text style={{ opacity: 0.7, marginHorizontal: 12, marginBottom: 4, marginTop: 8 }}>
					Comma-separated channel IDs to ignore
				</Text>
				<FormInput title="" placeholder="123, 456" value={String(storage.ignoreChannels ?? "")} onChange={(v: string) => { storage.ignoreChannels = v; }} />
				<Text style={{ opacity: 0.7, marginHorizontal: 12, marginBottom: 4, marginTop: 8 }}>
					Comma-separated server IDs to ignore
				</Text>
				<FormInput title="" placeholder="123, 456" value={String(storage.ignoreGuilds ?? "")} onChange={(v: string) => { storage.ignoreGuilds = v; }} />
			</FormSection>
		</ScrollView>
	);
}

export default {
	onLoad: () => {
		subscribed = subscribeFlux();
	},
	onUnload: () => {
		try { saveCache(true); } catch { }
		memCache = null;
		while (unsubs.length) {
			try { unsubs.pop()?.(); } catch { }
		}
		subscribed = false;
	},
	settings: Settings,
};
