import { find, findByDisplayName, findByName } from "@vendetta/metro";
import { React, ReactNative, clipboard } from "@vendetta/metro/common";
import { after } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { semanticColors } from "@vendetta/ui";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";
import { findInReactTree } from "@vendetta/utils";

// Mobile has no DOM/CSS cascade, so fonts and transparency sliders cannot
// run here. Accent colors patch the runtime color layer, and wallpapers wrap
// the chat view in an ImageBackground (the same technique the loader's own
// theme engine uses). Fonts stay in your loader's Themes page.

storage.accent ??= "default";
storage.amoled ??= false;
storage.wallpaperUrl ??= "";
storage.wallpaperBlur ??= "0";
storage.wallpaperDim ??= "0.4";

const { ScrollView, Text } = ReactNative;
const { FormSection, FormRow, FormRadioRow, FormSwitchRow, FormInput } = Forms;

const ACCENTS = [
	{ name: "Discord default", value: "default" },
	{ name: "BetterVencord green", value: "#43b581" },
	{ name: "Bluple", value: "#5865f2" },
	{ name: "Fuchsia", value: "#eb459e" },
	{ name: "Orange", value: "#ed7d31" },
	{ name: "Red", value: "#ed4245" },
];

const BRAND_KEYS = ["BRAND_500", "BRAND_560", "BRAND_600"];
const BG_KEYS = [
	"BACKGROUND_PRIMARY",
	"BACKGROUND_SECONDARY",
	"BACKGROUND_TERTIARY",
	"BACKGROUND_MOBILE_PRIMARY",
	"BACKGROUND_MOBILE_SECONDARY",
	"BG_BASE_PRIMARY",
	"BG_BASE_SECONDARY",
	"BG_BASE_TERTIARY",
	"CHAT_BACKGROUND",
];

const originals = new Map<string, any>();
let lastApplied: string[] = [];

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
	lastApplied = [];
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

function applyTheme(): string[] {
	restore();
	const applied: string[] = [];
	try {
		const sc = semanticColors as any;
		if (!sc || typeof sc !== "object") return applied;
		const accent = String(storage.accent ?? "default");
		if (accent !== "default" && /^#[0-9a-f]{6}$/i.test(accent)) {
			const vals = [accent, shade(accent, 0.82), shade(accent, 0.65)];
			BRAND_KEYS.forEach((k, i) => {
				if (trySet(sc, k, vals[i])) applied.push(k);
			});
		}
		if (storage.amoled) {
			for (const k of BG_KEYS) {
				if (trySet(sc, k, "#000000")) applied.push(k);
			}
		}
	} catch { /* never break Discord over a color */ }
	lastApplied = applied;
	return applied;
}

let unpatchWallpaper: (() => void) | undefined;
let wallpaperSupported = false;
let resolvedChatView = "";

// The chat view's component name changes between Discord versions, so try
// every known name through every lookup before giving up.
function resolveChatView(): { obj: any; key: string; name: string; } | null {
	const names = ["MessagesConnected", "Messages", "ChatMessages", "MessageListConnected", "ConnectedMessages"];
	const lookups: ((n: string) => any)[] = [
		(n) => findByDisplayName(n, false),
		(n) => findByName(n, false),
		(n) => findByDisplayName(n, true),
		(n) => findByName(n, true),
	];
	const seen = new Set<any>();
	const unwrap = (holder: any): { obj: any; key: string; } | null => {
		if (!holder) return null;
		for (const k of [holder, holder?.default, holder?.type]) {
			try {
				if (k?.prototype?.render && typeof k.prototype.render === "function")
					return { obj: k.prototype, key: "render" };
				if (typeof k === "function" && holder && typeof holder === "object" && holder.default === k)
					return { obj: holder, key: "default" };
			} catch { /* try next shape */ }
		}
		return null;
	};

	for (const n of names) {
		for (const get of lookups) {
			let c: any;
			try { c = get(n); } catch { continue; }
			if (!c || seen.has(c)) continue;
			seen.add(c);
			const hit = unwrap(c);
			if (hit) return { ...hit, name: n };
		}
		try {
			const m = find((exp: any) => exp?.default?.displayName === n || exp?.displayName === n || exp?.default?.name === n);
			if (m && !seen.has(m)) {
				seen.add(m);
				const hit = unwrap(m);
				if (hit) return { ...hit, name: n };
			}
		} catch { /* keep looking */ }
	}
	return null;
}

function num(v: unknown, fb: number): number {
	const n = Number(v);
	return Number.isFinite(n) ? n : fb;
}

function WallpaperBackground({ children }: { children: React.ReactNode; }) {
	const uri = String(storage.wallpaperUrl ?? "").trim();
	if (!uri) return <>{children}</>;
	const RN = ReactNative as any;
	const dim = Math.max(0, Math.min(0.95, num(storage.wallpaperDim, 0.4)));
	const blur = Math.max(0, num(storage.wallpaperBlur, 0));
	return (
		<RN.ImageBackground style={{ flex: 1, height: "100%" }} source={{ uri }} blurRadius={blur}>
			<RN.View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "black", opacity: dim }} />
			{children}
		</RN.ImageBackground>
	);
}

function patchWallpaper() {
	if (unpatchWallpaper) {
		try { unpatchWallpaper(); } catch { }
		unpatchWallpaper = undefined;
	}
	wallpaperSupported = false;
	resolvedChatView = "";
	try {
		const RN = ReactNative as any;
		if (!RN?.ImageBackground || !RN?.View) return;
		const view = resolveChatView();
		if (!view) return;
		unpatchWallpaper = after(view.key, view.obj, (_: any, ret: any) => {
			try {
				const uri = String(storage.wallpaperUrl ?? "").trim();
				if (!uri) return ret;
				// Make the messages layer transparent so the image shows
				// through, mirroring the loader's own theme-background patch.
				const node = findInReactTree(ret, (t: any) => t?.props && "HACK_fixModalInteraction" in t.props && t.props.style);
				if (node?.props) {
					node.props.style = [node.props.style, { backgroundColor: "transparent" }];
				}
				return <WallpaperBackground>{ret}</WallpaperBackground>;
			} catch {
				return ret;
			}
		});
		resolvedChatView = view.name;
		wallpaperSupported = true;
	} catch { /* chat view unavailable on this version */ }
}

function Settings() {
	useProxy(storage);
	const [status, setStatus] = React.useState("");
	const [wpStatus, setWpStatus] = React.useState("");

	function describe(c: any): string {
		try {
			if (!c) return "missing";
			if (c?.prototype?.render) return "class-component";
			if (typeof c === "function") return "function-component";
			if (typeof c === "object") return `object[${Object.keys(c).slice(0, 6).join("|")}]`;
			return typeof c;
		} catch {
			return "unreadable";
		}
	}

	function copyDiagnostics() {
		const names = ["MessagesConnected", "Messages", "ChatMessages", "MessageListConnected", "ConnectedMessages"];
		const lines: string[] = [];
		try {
			const RN = ReactNative as any;
			lines.push(`ImageBackground: ${!!RN?.ImageBackground}, View: ${!!RN?.View}`);
		} catch (e) {
			lines.push(`RN check failed: ${e instanceof Error ? e.message : e}`);
		}
		for (const n of names) {
			const bits: string[] = [];
			try { bits.push(`displayName=${describe(findByDisplayName(n, false))}`); }
			catch { bits.push("displayName=THROWS"); }
			try { bits.push(`name=${describe(findByName(n, false))}`); }
			catch { bits.push("name=THROWS"); }
			lines.push(`${n}: ${bits.join(", ")}`);
		}
		lines.push(`hook: ${wallpaperSupported ? `attached (${resolvedChatView})` : "not attached"}`);
		try {
			clipboard.setString(lines.join("\n"));
			showToast("Diagnostics copied - send them to the dev");
			setWpStatus("Diagnostics copied to clipboard. Send them over so the hook can be targeted.");
		} catch {
			setWpStatus("Copy failed (clipboard unavailable).");
		}
	}

	function reapply() {
		const applied = applyTheme();
		if (applied.length) {
			setStatus(`Applied ${applied.length} color key(s): ${applied.slice(0, 6).join(", ")}${applied.length > 6 ? "..." : ""}.`);
			showToast("Theme applied");
		} else {
			setStatus("No theme keys were patchable on this Discord version. Accent/AMOLED need a loader theme instead; your choices are saved and retried on each start.");
		}
	}

	return (
		<ScrollView style={{ flex: 1 }}>
			<FormSection title="Accent color">
				{ACCENTS.map(a => (
					<FormRadioRow
						key={a.value}
						label={a.name}
						subLabel={a.value === "default" ? "No override" : a.value}
						selected={storage.accent === a.value}
						onPress={() => {
							storage.accent = a.value;
							reapply();
						}}
					/>
				))}
			</FormSection>
			<FormSection title="Backgrounds">
				<FormSwitchRow
					label="True-black (AMOLED)"
					subLabel="Forces background colors to black"
					value={!!storage.amoled}
					onValueChange={v => {
						storage.amoled = v;
						reapply();
					}}
				/>
				<FormRow
					label="Re-apply theme"
					subLabel="Discord reloads colors on theme change; tap to re-apply"
					onPress={reapply}
				/>
				{!!status && (
					<FormRow label="Status" subLabel={status} />
				)}
			</FormSection>
			<FormSection title="Wallpaper">
				<Text style={{ opacity: 0.7, marginHorizontal: 12, marginBottom: 4 }}>
					Chat background image (direct image URL). Dim darkens it so text stays readable.
				</Text>
				<FormInput
					title=""
					placeholder="https://.../wallpaper.jpg"
					value={String(storage.wallpaperUrl ?? "")}
					onChange={(v: string) => { storage.wallpaperUrl = v; }}
				/>
				<Text style={{ opacity: 0.7, marginHorizontal: 12, marginBottom: 4, marginTop: 8 }}>
					Blur (0-25, 0 = off)
				</Text>
				<FormInput
					title=""
					placeholder="0"
					value={String(storage.wallpaperBlur ?? "")}
					onChange={(v: string) => { storage.wallpaperBlur = v.replace(/[^0-9.]/g, ""); }}
				/>
				<Text style={{ opacity: 0.7, marginHorizontal: 12, marginBottom: 4, marginTop: 8 }}>
					Darken overlay (0-0.95)
				</Text>
				<FormInput
					title=""
					placeholder="0.4"
					value={String(storage.wallpaperDim ?? "")}
					onChange={(v: string) => { storage.wallpaperDim = v.replace(/[^0-9.]/g, ""); }}
				/>
				<FormRow
					label="Wallpaper status"
					subLabel={!wallpaperSupported
						? "Chat view hook unavailable on this Discord version."
						: storage.wallpaperUrl
							? `Active via ${resolvedChatView}. Switch channels to refresh the view.`
							: `Hook ready (${resolvedChatView}). Add a URL above to enable.`}
				/>
				{!!storage.wallpaperUrl && (
					<FormRow
						label="Remove wallpaper"
						onPress={() => {
							storage.wallpaperUrl = "";
							setWpStatus("Wallpaper removed. Switch channels to refresh.");
						}}
					/>
				)}
				<FormRow
					label="Copy diagnostics"
					subLabel="Copies the chat-view lookup results for the dev"
					onPress={copyDiagnostics}
				/>
				{!!wpStatus && (
					<FormRow label="Status" subLabel={wpStatus} />
				)}
			</FormSection>
			<FormSection title="Mobile notes">
				<Text style={{ opacity: 0.7, marginHorizontal: 12, marginVertical: 6 }}>
					Fonts need a full theme: install one from your loader's Themes page.
					Per-server wallpapers live in GuildStyler and override this one.
				</Text>
			</FormSection>
		</ScrollView>
	);
}

export default {
	onLoad: () => {
		try { applyTheme(); } catch { }
		patchWallpaper();
	},
	onUnload: () => {
		try { unpatchWallpaper?.(); } catch { }
		unpatchWallpaper = undefined;
		wallpaperSupported = false;
		resolvedChatView = "";
		try { restore(); } catch { }
	},
	settings: Settings,
};
