/*
 * Ported from Vencord's CopyStickerLinks plugin (original authors: Ven, Byeoon).
 * Vencord is GPL-3.0-or-later; this mobile port is distributed under the same terms.
 *
 * Mobile adaptation: desktop hooks message and expression-picker context
 * menus (DOM). On mobile, copy/open rows are added to the sticker action
 * sheet (same technique as the community sticker-utils tweak) plus a copy
 * row on sticker messages in the long-press sheet.
 */

import { find, findByProps } from "@vendetta/metro";
import { React, clipboard, url } from "@vendetta/metro/common";
import { after, before } from "@vendetta/patcher";
import { findInReactTree } from "@vendetta/utils";
import { Button } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

const AnyButton = Button as any;
const StickerExt = [, "png", "png", "json", "gif"] as const;

const patches: (() => void)[] = [];

function getUrl(id: string, formatType: number): string {
	const ext = StickerExt[formatType] ?? "png";
	return `https://cdn.discordapp.com/stickers/${id}.${ext}?size=512&lossless=true`;
}

function firstStickerOf(message: any): { id: string; format_type: number; } | null {
	try {
		const items = message?.stickerItems ?? message?.stickers ?? [];
		for (const s of items) {
			if (s?.id && s?.format_type) return { id: String(s.id), format_type: Number(s.format_type) };
		}
	} catch { /* ignore */ }
	return null;
}

function patchStickerSheet() {
	try {
		const ActionSheet = findByProps("ActionSheet")?.ActionSheet ?? find((m: any) => m?.render?.name === "ActionSheet");
		if (!ActionSheet) return;
		const { hideActionSheet } = findByProps("hideActionSheet");

		patches.push(before("render", ActionSheet, ([props]: any[]) => {
			try {
				const holder = findInReactTree(props, (x: any) => Array.isArray(x?.children));
				const sticker = findInReactTree(props, (x: any) => typeof x?.sticker === "object" && x?.sticker?.hasOwnProperty?.("guild_id"))?.sticker;
				if (!holder || !sticker?.id || !sticker?.format_type) return;
				const link = getUrl(String(sticker.id), Number(sticker.format_type));

				holder.children[1] = (
					<>
						{holder.children[1]}
						<AnyButton
							text="Copy sticker link"
							color="brand"
							size="small"
							style={{ marginBottom: 10 }}
							onPress={() => {
								try {
									clipboard.setString(link);
									hideActionSheet();
									showToast("Sticker link copied to clipboard");
								} catch {
									showToast("Copy failed");
								}
							}}
						/>
						<AnyButton
							text="Open sticker link"
							color="brand"
							size="small"
							style={{ marginBottom: 10 }}
							onPress={() => {
								try {
									hideActionSheet();
									url.openURL(link);
								} catch {
									showToast("Could not open link");
								}
							}}
						/>
					</>
				);
			} catch { /* never break sheets */ }
		}));
	} catch { /* sticker sheet unavailable */ }
}

function patchMessageSheet() {
	try {
		const LazyActionSheet = findByProps("openLazy", "hideActionSheet");
		if (!LazyActionSheet) return;
		const RowComponent = (findByProps("ActionSheetRow") as any)?.ActionSheetRow;

		patches.push(before("openLazy", LazyActionSheet, ([component, key, msg]: any[]) => {
			const message = msg?.message;
			if (key !== "MessageLongPressActionSheet" || !message) return;
			const sticker = firstStickerOf(message);
			if (!sticker || !RowComponent) return;
			const link = getUrl(sticker.id, sticker.format_type);

			component.then((instance: any) => {
				const unpatch = after("default", instance, (_: any, comp: any) => {
					React.useEffect(() => () => { unpatch(); }, []);

					const row = React.createElement(RowComponent, {
						label: "Copy sticker link",
						onPress: () => {
							try { LazyActionSheet.hideActionSheet(); } catch { }
							try {
								clipboard.setString(link);
								showToast("Sticker link copied to clipboard");
							} catch {
								showToast("Copy failed");
							}
						},
					});

					const buttons = findInReactTree(comp, (x: any) => Array.isArray(x) && x[0]?.type?.name === "ActionSheetRow");
					if (buttons) buttons.push(row);
				});
			}).catch(() => { /* sheet internals changed */ });
		}));
	} catch { /* long-press menu unavailable */ }
}

export default {
	onLoad: () => {
		patchStickerSheet();
		patchMessageSheet();
	},
	onUnload: () => {
		while (patches.length) {
			try { patches.pop()?.(); } catch { }
		}
	},
};
