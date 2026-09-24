import { findByStoreName } from "@vendetta/metro";
import { React, ReactNative } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { semanticColors } from "@vendetta/ui";
import { Button, Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

// Mobile companion to DiscordStyler: per-server accent colors applied to the
// same runtime color layer. Servers without a mapping keep whatever the
// global theme/accent currently is.

storage.enabled ??= true;
storage.maps ??= {};

const { ScrollView, Text } = ReactNative;
const { FormSection, FormRow, FormInput, FormSwitchRow } = Forms;
// vendetta-types ships its own React types; Button misaligns with them, so
// treat it as untyped (runtime is unaffected).
const AnyButton = Button as any;

const BRAND_KEYS = ["BRAND_500", "BRAND_560", "BRAND_600"];

interface GuildMap {
	name: string;
	accent: string;
}

const originals = new Map<string, any>();

function readMaps(): Record<string, GuildMap> {
	const m = storage.maps as Record<string, GuildMap> | undefined;
	return m && typeof m === "object" ? m : {};
}

function shade(hex: string, f: number): string {
	const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
	if (!m) return "#5865f2";
	const px = (i: number) => Math.max(0, Math.min(255, Math.round(parseInt(m[i], 16) * f)));
	const hx = (n: number) => n.toString(16).padStart(2, "0");
	return `#${hx(px(1))}${hx(px(2))}${hx(px(3))}`;
}

function restore() {
	try {
		const sc = semanticColors as any;
		for (const [k, v] of originals) {
			try { sc[k] = v; } catch { /* ignore */ }
		}
	} catch { /* ignore */ }
	originals.clear();
}

function trySet(sc: any, key: string, value: string): boolean {
	try {
		if (!(key in sc)) return false;
		if (!originals.has(key)) originals.set(key, sc[key]);
		sc[key] = value;
		return sc[key] === value;
	} catch {
		return false;
	}
}

function currentGuild(): { id: string | null; name: string; } {
	try {
		const id = findByStoreName("SelectedGuildStore")?.getGuildId?.();
		if (!id) return { id: null, name: "" };
		let name = "this server";
		try {
			name = findByStoreName("GuildStore")?.getGuild?.(id)?.name ?? name;
		} catch { /* fine */ }
		return { id, name };
	} catch {
		return { id: null, name: "" };
	}
}

function applyForGuild(guildId: string | null): boolean {
	restore();
	try {
		if (!storage.enabled || !guildId) return false;
		const hit = readMaps()[guildId];
		if (!hit?.accent || !/^#[0-9a-f]{6}$/i.test(hit.accent)) return false;
		const sc = semanticColors as any;
		if (!sc || typeof sc !== "object") return false;
		const vals = [hit.accent, shade(hit.accent, 0.82), shade(hit.accent, 0.65)];
		let ok = false;
		BRAND_KEYS.forEach((k, i) => {
			if (trySet(sc, k, vals[i])) ok = true;
		});
		return ok;
	} catch {
		return false;
	}
}

let unsubscribe: (() => void) | undefined;

function subscribe() {
	try {
		const store = findByStoreName("SelectedGuildStore");
		if (store?.addChangeListener && store?.removeChangeListener) {
			const cb = () => {
				try { applyForGuild(currentGuild().id); } catch { }
			};
			store.addChangeListener(cb);
			unsubscribe = () => {
				try { store.removeChangeListener(cb); } catch { }
			};
		}
	} catch { /* manual Apply button covers this case */ }
}

function Settings() {
	useProxy(storage);
	const [hex, setHex] = React.useState("");
	const [status, setStatus] = React.useState("");
	const g = currentGuild();
	const maps = readMaps();
	const ids = Object.keys(maps);

	function save() {
		if (!g.id) {
			setStatus("Open a server first.");
			return;
		}
		const accent = hex.trim();
		if (!/^#[0-9a-f]{6}$/i.test(accent)) {
			setStatus("Enter a hex color like #43b581.");
			return;
		}
		storage.maps = { ...maps, [g.id]: { name: g.name, accent } };
		setHex("");
		const ok = applyForGuild(g.id);
		setStatus(ok ? `Saved accent for ${g.name}.` : "Saved. Accent keys were not patchable on this version.");
	}

	function remove(id: string) {
		const next = { ...readMaps() };
		delete next[id];
		storage.maps = next;
		if (currentGuild().id === id) applyForGuild(id);
		setStatus("Removed server mapping.");
	}

	function applyNow() {
		const ok = applyForGuild(currentGuild().id);
		setStatus(ok ? "Applied server accent." : "Nothing to apply (no mapping, or keys not patchable on this version).");
		if (ok) showToast("Server accent applied");
	}

	return (
		<ScrollView style={{ flex: 1 }}>
			<FormSection title="Guild accents">
				<FormSwitchRow
					label="Enabled"
					subLabel="Auto-swap accent on server switch"
					value={!!storage.enabled}
					onValueChange={v => {
						storage.enabled = v;
						applyForGuild(currentGuild().id);
					}}
				/>
				<FormRow label="Current server" subLabel={g.name ? `${g.name} (${g.id})` : "open a server first"} />
				<Text style={{ opacity: 0.7, marginHorizontal: 12, marginBottom: 4 }}>
					Hex accent for the current server (e.g. #43b581)
				</Text>
				<FormInput
					title=""
					placeholder="#43b581"
					value={hex}
					onChange={setHex}
				/>
				<FormRow label="Save accent for this server" onPress={save} />
				<FormRow label="Apply now" subLabel="Re-apply for the open server" onPress={applyNow} />
				{!!status && (
					<FormRow label="Status" subLabel={status} />
				)}
			</FormSection>
			<FormSection title={`Mapped servers (${ids.length})`}>
				{ids.length === 0 && (
					<Text style={{ opacity: 0.7, marginHorizontal: 12 }}>
						No per-server accents yet.
					</Text>
				)}
				{ids.map(id => (
					<FormRow
						key={id}
						label={maps[id]?.name || id.slice(-6)}
						subLabel={maps[id]?.accent}
						trailing={() => (
							<AnyButton
								text="Remove"
								color="red"
								size="small"
								onPress={() => remove(id)}
							/>
						)}
					/>
				))}
			</FormSection>
		</ScrollView>
	);
}

export default {
	onLoad: () => {
		try { applyForGuild(currentGuild().id); } catch { }
		subscribe();
	},
	onUnload: () => {
		try { unsubscribe?.(); } catch { }
		unsubscribe = undefined;
		try { restore(); } catch { }
	},
	settings: Settings,
};
