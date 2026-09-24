import { findByProps, findByStoreName } from "@vendetta/metro";
import { React, ReactNative, clipboard } from "@vendetta/metro/common";
import { showConfirmationAlert } from "@vendetta/ui/alerts";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

const { ScrollView, Text } = ReactNative;
const { FormSection, FormRow } = Forms;

interface Emoji {
	id: string;
	name: string;
	animated?: boolean;
}

interface Sticker {
	id: string;
	name: string;
	description?: string;
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

async function apiGet(url: string): Promise<any> {
	const h = findByProps("getAPIBaseURL", "get");
	if (!h) throw new Error("Discord HTTP module not found on this version.");
	const res = await h.get({ url });
	return res?.body;
}

async function apiDelete(url: string): Promise<void> {
	const h: any = findByProps("getAPIBaseURL", "get");
	if (!h) throw new Error("Discord HTTP module not found on this version.");
	const fn = h.delete ?? h.del ?? h["delete"];
	if (typeof fn !== "function") throw new Error("Delete is not supported on this version.");
	await fn.call(h, { url });
}

function Settings() {
	const [status, setStatus] = React.useState("");
	const [busy, setBusy] = React.useState(false);
	const [emojis, setEmojis] = React.useState<Emoji[] | null>(null);
	const [stickers, setStickers] = React.useState<Sticker[] | null>(null);
	const g = currentGuild();

	async function scan() {
		if (busy) return;
		if (!g.id) {
			setStatus("Open a server first.");
			return;
		}
		setBusy(true);
		setStatus("Scanning...");
		try {
			const [er, sr] = await Promise.all([
				apiGet(`/guilds/${g.id}/emojis`),
				apiGet(`/guilds/${g.id}/stickers`),
			]);
			const e = (Array.isArray(er) ? er : []) as Emoji[];
			const s = (Array.isArray(sr) ? sr : []) as Sticker[];
			setEmojis(e);
			setStickers(s);
			setStatus(`${e.length} emojis, ${s.length} stickers in ${g.name}.`);
		} catch (e) {
			setStatus(`Scan failed: ${e instanceof Error ? e.message : e} (needs Manage Expressions permission).`);
		} finally {
			setBusy(false);
		}
	}

	function confirmDelete(title: string, body: string, onConfirm: () => void) {
		try {
			showConfirmationAlert({
				title,
				content: body,
				confirmText: "Delete",
				cancelText: "Cancel",
				onConfirm,
			});
		} catch {
			onConfirm();
		}
	}

	async function removeEmoji(id: string, name: string) {
		if (!g.id) return;
		confirmDelete(`Delete :${name}:?`, "This cannot be undone.", async () => {
			try {
				await apiDelete(`/guilds/${g.id}/emojis/${id}`);
				setEmojis(prev => (prev ?? []).filter(e => e.id !== id));
				setStatus(`Deleted :${name}:.`);
			} catch (e) {
				setStatus(`Delete failed: ${e instanceof Error ? e.message : e}.`);
			}
		});
	}

	async function removeSticker(id: string, name: string) {
		if (!g.id) return;
		confirmDelete(`Delete "${name}"?`, "This cannot be undone.", async () => {
			try {
				await apiDelete(`/guilds/${g.id}/stickers/${id}`);
				setStickers(prev => (prev ?? []).filter(s => s.id !== id));
				setStatus(`Deleted sticker "${name}".`);
			} catch (e) {
				setStatus(`Delete failed: ${e instanceof Error ? e.message : e}.`);
			}
		});
	}

	function exportJson() {
		if (!g.id) return;
		try {
			clipboard.setString(JSON.stringify({ server: g.name, emojis, stickers }, null, 2));
			setStatus("Inventory copied to clipboard as JSON.");
			showToast("Inventory copied to clipboard");
		} catch {
			setStatus("Export failed (clipboard unavailable).");
		}
	}

	return (
		<ScrollView style={{ flex: 1 }}>
			<FormSection title="Server janitor">
				<FormRow label="Server" subLabel={g.name || "open a server first"} />
				<FormRow
					label={busy ? "Scanning..." : "Scan expressions"}
					subLabel="Inventory emojis and stickers in this server"
					onPress={scan}
				/>
				{(emojis || stickers) && (
					<FormRow
						label="Export JSON"
						subLabel="Copy the full inventory to your clipboard"
						onPress={exportJson}
					/>
				)}
				{!!status && (
					<FormRow label="Status" subLabel={status} />
				)}
			</FormSection>
			{emojis && (
				<FormSection title={`Emojis (${emojis.length})`}>
					{emojis.length === 0 && (
						<Text style={{ opacity: 0.7, marginHorizontal: 12 }}>No custom emojis.</Text>
					)}
					{emojis.slice(0, 100).map(e => (
						<FormRow
							key={e.id}
							label={`:${e.name}:${e.animated ? " (gif)" : ""}`}
							subLabel="Tap to delete"
							onPress={() => removeEmoji(e.id, e.name)}
						/>
					))}
					{emojis.length > 100 && (
						<Text style={{ opacity: 0.7, marginHorizontal: 12 }}>
							Showing first 100 of {emojis.length}.
						</Text>
					)}
				</FormSection>
			)}
			{stickers && (
				<FormSection title={`Stickers (${stickers.length})`}>
					{stickers.length === 0 && (
						<Text style={{ opacity: 0.7, marginHorizontal: 12 }}>No stickers.</Text>
					)}
					{stickers.slice(0, 100).map(s => (
						<FormRow
							key={s.id}
							label={s.name}
							subLabel="Tap to delete"
							onPress={() => removeSticker(s.id, s.name)}
						/>
					))}
					{stickers.length > 100 && (
						<Text style={{ opacity: 0.7, marginHorizontal: 12 }}>
							Showing first 100 of {stickers.length}.
						</Text>
					)}
				</FormSection>
			)}
		</ScrollView>
	);
}

export default {
	settings: Settings,
};
