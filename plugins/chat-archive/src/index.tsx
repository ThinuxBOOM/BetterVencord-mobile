import { findByProps, findByStoreName } from "@vendetta/metro";
import { React, ReactNative, clipboard } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

storage.format ??= "md";
storage.limit ??= "500";

const { ScrollView, Text } = ReactNative;
const { FormSection, FormRow, FormRadioRow, FormInput } = Forms;

interface Msg {
	id: string;
	content: string;
	timestamp: string;
	author?: { username?: string; global_name?: string | null; bot?: boolean; };
	attachments?: { url?: string; filename?: string; }[];
}

function http(): any {
	return findByProps("getAPIBaseURL", "get");
}

async function apiGet(url: string): Promise<any> {
	const h = http();
	if (!h) throw new Error("Discord HTTP module not found on this version.");
	const res = await h.get({ url });
	return res?.body;
}

function currentChannelId(): string {
	try {
		return findByStoreName("SelectedChannelStore")?.getChannelId?.() ?? "";
	} catch {
		return "";
	}
}

function esc(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function toMarkdown(msgs: Msg[]): string {
	return msgs.map(m => {
		const who = m.author?.global_name || m.author?.username || "unknown";
		const when = new Date(m.timestamp).toLocaleString();
		const atts = (m.attachments || []).map(a => `\n![${a.filename || "attachment"}](${a.url})`).join("");
		return `**${who}** _${when}_\n${m.content || ""}${atts}`;
	}).join("\n\n---\n\n");
}

function toHtml(msgs: Msg[], title: string): string {
	const rows = msgs.map(m => {
		const who = esc(m.author?.global_name || m.author?.username || "unknown");
		const when = esc(new Date(m.timestamp).toLocaleString());
		const atts = (m.attachments || []).map(a => `<br><a href="${esc(a.url || "")}">${esc(a.filename || "attachment")}</a>`).join("");
		return `<div class="m"><div class="h"><b>${who}</b> <span>${when}</span></div><div>${esc(m.content || "")}${atts}</div></div>`;
	}).join("\n");
	return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>` +
		"<style>body{font-family:sans-serif;background:#313338;color:#dbdee1;max-width:800px;margin:auto;padding:16px}" +
		".m{margin-bottom:14px}.h span{color:#949ba4;font-size:12px}a{color:#00a8fc}</style></head>" +
		`<body><h2>${esc(title)} (${msgs.length} messages)</h2>${rows}</body></html>`;
}

async function fetchHistory(channelId: string, max: number, onProgress: (n: number) => void): Promise<Msg[]> {
	const out: Msg[] = [];
	let before: string | undefined;
	const cap = Math.max(50, Math.min(2000, max || 500));
	while (out.length < cap) {
		const page = await apiGet(`/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ""}`);
		const arr = (Array.isArray(page) ? page : []) as Msg[];
		if (arr.length === 0) break;
		out.push(...arr);
		onProgress(out.length);
		if (arr.length < 100) break;
		before = arr[arr.length - 1].id;
		await new Promise(r => setTimeout(r, 250));
	}
	return out.slice(0, cap).reverse();
}

function Settings() {
	useProxy(storage);
	const [status, setStatus] = React.useState("");
	const [busy, setBusy] = React.useState(false);

	async function run() {
		if (busy) return;
		const channelId = currentChannelId();
		if (!channelId) {
			setStatus("Open a channel first.");
			return;
		}
		setBusy(true);
		setStatus("Exporting: 0");
		try {
			const msgs = await fetchHistory(channelId, Number(storage.limit) || 500, n => setStatus(`Exporting: ${n}`));
			if (!msgs.length) {
				setStatus("No messages found (or no permission to read history).");
				return;
			}
			const fmt = storage.format === "html" ? "html" : "md";
			const stamp = new Date().toISOString().slice(0, 10);
			const title = `discord-archive-${channelId.slice(-6)}-${stamp}`;
			const text = fmt === "md" ? toMarkdown(msgs) : toHtml(msgs, title);
			clipboard.setString(text);
			setStatus(`Done: ${msgs.length} messages copied to clipboard as ${fmt.toUpperCase()}.`);
			showToast(`Copied ${msgs.length} messages to clipboard`);
		} catch (e) {
			setStatus(e instanceof Error ? e.message : "Export failed.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<ScrollView style={{ flex: 1 }}>
			<FormSection title="Export">
				<FormRow
					label={busy ? "Exporting..." : "Export current channel"}
					subLabel="Reads the open channel's history and copies it to your clipboard"
					onPress={run}
				/>
				{!!status && (
					<FormRow label="Status" subLabel={status} />
				)}
			</FormSection>
			<FormSection title="Format">
				<FormRadioRow
					label="Markdown"
					subLabel="Best for pasting into notes apps"
					selected={storage.format !== "html"}
					onPress={() => { storage.format = "md"; }}
				/>
				<FormRadioRow
					label="HTML"
					subLabel="Full page markup, paste into an .html file"
					selected={storage.format === "html"}
					onPress={() => { storage.format = "html"; }}
				/>
			</FormSection>
			<FormSection title="Options">
				<Text style={{ opacity: 0.7, marginHorizontal: 12, marginBottom: 4 }}>
					Max messages per export (cap 2000 on mobile)
				</Text>
				<FormInput
					title=""
					placeholder="500"
					value={String(storage.limit ?? "")}
					onChange={(v: string) => { storage.limit = v.replace(/[^0-9]/g, ""); }}
				/>
			</FormSection>
		</ScrollView>
	);
}

export default {
	settings: Settings,
};
