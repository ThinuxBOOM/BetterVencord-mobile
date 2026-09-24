import { findByName } from "@vendetta/metro";
import { React, ReactNative, clipboard } from "@vendetta/metro/common";
import { after } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";
import { findInReactTree } from "@vendetta/utils";

// Mobile port: the desktop CSS snippets become a live filter on the chat
// input's action buttons (same technique as the community hide-app-button
// tweak). Raw custom CSS has no cascade to attach to on React Native, so it
// is stored here for safekeeping and one-tap copying.

storage.hideGift ??= false;
storage.hideGif ??= false;
storage.hideStickers ??= false;
storage.hideApps ??= false;
storage.customCss ??= "";

const { ScrollView, Text } = ReactNative;
const { FormSection, FormRow, FormInput, FormSwitchRow } = Forms;

let unpatch: (() => void) | undefined;
let patchActive = false;
let resolvedCount = 0;

const GIFT_ASSETS = ["GiftIcon", "ic_gift", "gift"];
const GIF_ASSETS = ["icon-qs-gifs", "GifIcon", "ic_gif", "gif"];
const STICKER_ASSETS = ["icon-qs-stickers", "StickerIcon", "ic_sticker", "sticker"];
const APPS_ASSETS = ["AppsIcon"];

function resolveAssets(names: string[]): any[] {
	const out: any[] = [];
	for (const n of names) {
		try {
			const id = getAssetIDByName(n);
			if (id !== undefined && id !== null) out.push(id);
		} catch { /* unknown on this version */ }
	}
	return out;
}

function blockedSources(): any[] {
	const out: any[] = [];
	if (storage.hideGift) out.push(...resolveAssets(GIFT_ASSETS));
	if (storage.hideGif) out.push(...resolveAssets(GIF_ASSETS));
	if (storage.hideStickers) out.push(...resolveAssets(STICKER_ASSETS));
	if (storage.hideApps) out.push(...resolveAssets(APPS_ASSETS));
	return out;
}

function applyPatch() {
	if (unpatch) {
		try { unpatch(); } catch { }
		unpatch = undefined;
	}
	patchActive = false;
	resolvedCount = 0;
	try {
		const ChatInput = findByName("ChatInput");
		if (!ChatInput?.prototype?.render) return;
		unpatch = after("render", ChatInput.prototype, (_: any, ret: any) => {
			try {
				const block = blockedSources();
				if (!block.length) return;
				const input = findInReactTree(ret, (t: any) => t?.props && "forceAnimateButtons" in t.props && t.props.actions);
				if (!input?.props?.actions) return;
				input.props.actions = input.props.actions.filter((a: any) => !block.includes(a?.source));
			} catch { /* never break the chat input */ }
		});
		patchActive = true;
		resolvedCount = blockedSources().length;
	} catch { /* ChatInput internals changed; toggles stay saved */ }
}

function Settings() {
	useProxy(storage);
	const [status, setStatus] = React.useState("");

	function toggle(key: "hideGift" | "hideGif" | "hideStickers" | "hideApps", label: string) {
		return (v: boolean) => {
			storage[key] = v;
			// The live filter reads storage on every render, no re-patch needed.
			const n = blockedSources().length;
			setStatus(v
				? `${label} will hide (${n} button asset(s) resolved). If a button stays visible, its asset name changed on this Discord version.`
				: `${label} off.`);
		};
	}

	function copyCss() {
		try {
			clipboard.setString(String(storage.customCss ?? ""));
			showToast("Custom CSS copied");
			setStatus("Custom CSS copied. Paste it into your desktop client or a theme file; it cannot apply to the mobile app directly (React Native has no CSS cascade).");
		} catch {
			setStatus("Copy failed (clipboard unavailable).");
		}
	}

	return (
		<ScrollView style={{ flex: 1 }}>
			<FormSection title="Chat input cleanups">
				<FormSwitchRow
					label="Hide gift button"
					subLabel="Removes the Nitro gift button from the message box"
					value={!!storage.hideGift}
					onValueChange={toggle("hideGift", "Gift button")}
				/>
				<FormSwitchRow
					label="Hide GIF button"
					subLabel="Removes the GIF picker button from the message box"
					value={!!storage.hideGif}
					onValueChange={toggle("hideGif", "GIF button")}
				/>
				<FormSwitchRow
					label="Hide sticker button"
					subLabel="Removes the sticker picker button from the message box"
					value={!!storage.hideStickers}
					onValueChange={toggle("hideStickers", "Sticker button")}
				/>
				<FormSwitchRow
					label="Hide Apps button"
					subLabel="Removes the app launcher button from the message box"
					value={!!storage.hideApps}
					onValueChange={toggle("hideApps", "Apps button")}
				/>
				<FormRow
					label="Patch status"
					subLabel={patchActive
						? `Chat input hook active (${resolvedCount} button asset(s) resolved).`
						: "Chat input hook not attached on this Discord version; toggles are saved and retried on restart."}
				/>
				{!!status && (
					<FormRow label="Status" subLabel={status} />
				)}
			</FormSection>
			<FormSection title="Custom CSS">
				<Text style={{ opacity: 0.7, marginHorizontal: 12, marginBottom: 4 }}>
					Stored for safekeeping and copying. It cannot restyle the mobile app directly.
				</Text>
				<FormInput
					title=""
					placeholder=".my-tweak { display: none !important; }"
					value={String(storage.customCss ?? "")}
					onChange={(v: string) => { storage.customCss = v; }}
				/>
				<FormRow
					label="Copy custom CSS"
					subLabel="Copy to clipboard for desktop use"
					onPress={copyCss}
				/>
			</FormSection>
		</ScrollView>
	);
}

export default {
	onLoad: applyPatch,
	onUnload: () => {
		try { unpatch?.(); } catch { }
		unpatch = undefined;
		patchActive = false;
	},
	settings: Settings,
};
