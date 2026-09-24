import { findByProps, findByStoreName } from "@vendetta/metro";
import { React, ReactNative, clipboard } from "@vendetta/metro/common";
import { before } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { showConfirmationAlert } from "@vendetta/ui/alerts";
import { Button, Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

storage.keepCount ??= "30";
storage.drafts ??= [];

const { ScrollView, Text } = ReactNative;
const { FormSection, FormRow, FormInput } = Forms;
// vendetta-types ships its own React types; Button misaligns with them, so
// treat it as untyped (runtime is unaffected).
const AnyButton = Button as any;

interface Draft {
	channelId: string;
	content: string;
	at: number;
}

let unpatchSend: (() => void) | undefined;

function readDrafts(): Draft[] {
	return Array.isArray(storage.drafts) ? storage.drafts as Draft[] : [];
}

function currentChannelId(): string {
	try {
		return findByStoreName("SelectedChannelStore")?.getChannelId?.() ?? "";
	} catch {
		return "";
	}
}

function timeAgo(at: number): string {
	const s = Math.floor((Date.now() - at) / 1000);
	if (s < 60) return `${s}s ago`;
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
	return `${Math.floor(s / 86400)}d ago`;
}

function hookSend() {
	try {
		const msgMod = findByProps("sendMessage", "receiveMessage");
		if (!msgMod) return;
		unpatchSend = before("sendMessage", msgMod, (args: any[]) => {
			try {
				// Mobile signature is (channelId, message); stay defensive across versions.
				let channelId = typeof args[0] === "string" ? args[0] : currentChannelId();
				let content = "";
				for (const a of args) {
					if (a && typeof a === "object" && typeof a.content === "string") {
						content = a.content;
						break;
					}
				}
				content = content.trim();
				if (!content || !channelId) return;
				const keep = Math.max(5, Math.min(100, Number(storage.keepCount) || 30));
				const all = readDrafts();
				const mine = all.filter(d => d.channelId === channelId);
				const rest = all.filter(d => d.channelId !== channelId);
				mine.unshift({ channelId, content, at: Date.now() });
				storage.drafts = [...mine.slice(0, keep), ...rest].slice(0, keep * 10);
			} catch { /* never block sending */ }
		});
	} catch { /* message module not found on this version; panel still shows history */ }
}

function Settings() {
	useProxy(storage);
	const [filter, setFilter] = React.useState("");

	const drafts = readDrafts();
	const shown = drafts
		.filter(d => !filter || d.content.toLowerCase().includes(filter.toLowerCase()))
		.slice(0, 60);

	function copy(d: Draft) {
		try {
			clipboard.setString(d.content);
			showToast("Draft copied to clipboard");
		} catch {
			showToast("Copy failed");
		}
	}

	function remove(d: Draft) {
		storage.drafts = readDrafts().filter(x => !(x.at === d.at && x.channelId === d.channelId));
	}

	function clearAll() {
		const doClear = () => {
			storage.drafts = [];
			showToast("Draft history cleared");
		};
		try {
			showConfirmationAlert({
				title: "Forget everything?",
				content: "This deletes your saved sent-message history on this device.",
				confirmText: "Delete",
				cancelText: "Cancel",
				onConfirm: doClear,
			});
		} catch {
			doClear();
		}
	}

	return (
		<ScrollView style={{ flex: 1 }}>
			<FormSection title="History">
				<FormInput
					title=""
					placeholder="Filter drafts..."
					value={filter}
					onChange={setFilter}
				/>
				<Text style={{ opacity: 0.7, marginHorizontal: 12, marginVertical: 6 }}>
					{drafts.length === 0
						? "Nothing saved yet. Send a message and it lands here."
						: `${drafts.length} remembered. Tap any draft to copy it back.`}
				</Text>
				{shown.map(d => (
					<FormRow
						key={`${d.channelId}-${d.at}`}
						label={d.content.slice(0, 80) || "(empty)"}
						subLabel={`#${d.channelId.slice(-6)} - ${timeAgo(d.at)} - tap to copy`}
						onPress={() => copy(d)}
						trailing={() => (
							<AnyButton
								text="Delete"
								color="red"
								size="small"
								onPress={() => remove(d)}
							/>
						)}
					/>
				))}
				{drafts.length > 0 && (
					<FormRow
						label="Forget everything"
						subLabel="Delete all saved drafts on this device"
						onPress={clearAll}
					/>
				)}
			</FormSection>
			<FormSection title="Options">
				<Text style={{ opacity: 0.7, marginHorizontal: 12, marginBottom: 4 }}>
					Messages remembered per channel
				</Text>
				<FormInput
					title=""
					placeholder="30"
					value={String(storage.keepCount ?? "")}
					onChange={(v: string) => { storage.keepCount = v.replace(/[^0-9]/g, ""); }}
				/>
			</FormSection>
		</ScrollView>
	);
}

export default {
	onLoad: hookSend,
	onUnload: () => { try { unpatchSend?.(); } catch { } unpatchSend = undefined; },
	settings: Settings,
};
