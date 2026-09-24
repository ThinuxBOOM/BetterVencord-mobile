/*
 * Ported from Vencord's CopyEmojiMarkdown plugin
 * (original authors: HappyEnderman, Vishnya).
 * Vencord is GPL-3.0-or-later; this mobile port is distributed under the same terms.
 *
 * Mobile adaptation: desktop hooks the expression picker (DOM). On mobile the
 * option lives in the message long-press sheet and copies every custom emoji
 * in that message as markdown.
 */

import { findByProps } from "@vendetta/metro";
import { React, clipboard } from "@vendetta/metro/common";
import { after, before } from "@vendetta/patcher";
import { findInReactTree } from "@vendetta/utils";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

const patches: (() => void)[] = [];

function extractMarkdown(content: string): string[] {
	const out: string[] = [];
	try {
		for (const m of content.matchAll(/<(a)?:(\w+):(\d+)>/gi)) {
			out.push(`<${m[1] ? "a" : ""}:${m[2]}:${m[3]}>`);
		}
	} catch { /* ignore */ }
	return [...new Set(out)];
}

function patchSheet() {
	try {
		const LazyActionSheet = findByProps("openLazy", "hideActionSheet");
		if (!LazyActionSheet) return;
		const RowComponent = (findByProps("ActionSheetRow") as any)?.ActionSheetRow ?? Forms.FormRow;

		patches.push(before("openLazy", LazyActionSheet, ([component, key, msg]: any[]) => {
			const message = msg?.message;
			if (key !== "MessageLongPressActionSheet" || typeof message?.content !== "string") return;
			const found = extractMarkdown(message.content);
			if (!found.length) return;

			component.then((instance: any) => {
				const unpatch = after("default", instance, (_: any, comp: any) => {
					React.useEffect(() => () => { unpatch(); }, []);

					const row = React.createElement(RowComponent, {
						label: `Copy emoji markdown (${found.length})`,
						onPress: () => {
							try { LazyActionSheet.hideActionSheet(); } catch { }
							try {
								clipboard.setString(found.join(" "));
								showToast("Emoji markdown copied to clipboard");
							} catch {
								showToast("Copy failed");
							}
						},
					});

					const groups: any[] = findInReactTree(
						comp,
						(c: any) => Array.isArray(c) && c[0]?.type?.name === "ActionSheetRowGroup"
					);
					if (groups?.length) {
						for (const g of groups) {
							const kids: any[] = findInReactTree(
								g,
								(c: any) => Array.isArray(c) && c.some((child: any) => child?.type?.name === "ActionSheetRow")
							);
							if (kids) {
								kids.push(row);
								return;
							}
						}
					}
					const buttons = findInReactTree(comp, (x: any) => Array.isArray(x) && x[0]?.type?.name === "ActionSheetRow");
					if (buttons) buttons.push(row);
				});
			}).catch(() => { /* sheet internals changed */ });
		}));
	} catch { /* long-press menu unavailable */ }
}

export default {
	onLoad: patchSheet,
	onUnload: () => {
		while (patches.length) {
			try { patches.pop()?.(); } catch { }
		}
	},
};
