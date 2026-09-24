import { find, findByDisplayName, findByName } from "@vendetta/metro";
import { React, ReactNative, clipboard, constants } from "@vendetta/metro/common";
import { after } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { semanticColors } from "@vendetta/ui";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";
import { findInReactTree } from "@vendetta/utils";

// Mobile has no DOM/CSS cascade, so transparency sliders cannot run here.
// Accent, text and background colors patch the runtime color layer, fonts
// patch the central Fonts constants, and wallpapers wrap the chat view in
// an ImageBackground (the same technique the loader's own theme engine uses).

storage.accent ??= "default";
storage.amoled ??= false;
storage.font ??= "default";
storage.customFont ??= "";
storage.wallpaperUrl ??= "";
storage.wallpaperBlur ??= "0";
storage.wallpaperDim ??= "0.4";
storage.textColor ??= "";
storage.mutedColor ??= "";
storage.channelColor ??= "";
storage.mentionColor ??= "";
storage.statusOnline ??= "";
storage.statusIdle ??= "";
storage.statusDnd ??= "";

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
const TEXT_KEYS = ["TEXT_NORMAL"];
const MUTED_KEYS = ["TEXT_MUTED"];
const CHANNEL_KEYS = ["CHANNELS_DEFAULT"];
const MENTION_KEYS = ["TEXT_BRAND", "MENTION_FOREGROUND", "TEXT_LINK"];
const ONLINE_KEYS = ["STATUS_POSITIVE", "STATUS_GREEN"];
const IDLE_KEYS = ["STATUS_WARNING", "STATUS_YELLOW"];
const DND_KEYS = ["STATUS_DANGER", "STATUS_RED"];

const FONT_PRESETS = [
	{ name: "Discord default", value: "default" },
	{ name: "Roboto", value: "Roboto" },
	{ name: "Sans serif", value: "sans-serif" },
	{ name: "Sans serif light", value: "sans-serif-light" },
	{ name: "Sans serif condensed", value: "sans-serif-condensed" },
	{ name: "Sans serif medium", value: "sans-serif-medium" },
	{ name: "Serif", value: "serif" },
	{ name: "Monospace", value: "monospace" },
	{ name: "Custom family (type below)", value: "custom" },
];

const fontOriginals = new Map<string, any>();
let lastFontApplied = 0;

function restoreFont() {
	try {
		const F = (constants as any)?.Fonts;
		if (F && typeof F === "object") {
			for (const [k, v] of fontOriginals) {
				try { F[k] = v; } catch { /* ignore */ }
			}
		}
	} catch { /* ignore */ }
	fontOriginals.clear();
	lastFontApplied = 0;
}

// Patches every string entry of the central Fonts constants to one family.
// Key names are enumerated live so this survives Discord renames.
function applyFont(): number {
	restoreFont();
	let count = 0;
	try {
		const choice = String(storage.font ?? "default");
		const family = choice === "custom"
			? String(storage.customFont ?? "").trim()
			: choice === "default" ? "" : choice;
		if (!family) return 0;
		const F = (constants as any)?.Fonts;
		if (!F || typeof F !== "object") return 0;
		for (const k of Object.keys(F)) {
			try {
				if (typeof F[k] === "string" && F[k]) {
					if (!fontOriginals.has(k)) fontOriginals.set(k, F[k]);
					F[k] = family;
					if (F[k] === family) count++;
				}
			} catch { /* skip locked keys */ }
		}
	} catch { /* never break Discord over a font */ }
	lastFontApplied = count;
	return count;
}
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
		const customs: [unknown, string[]][] = [
			[storage.textColor, TEXT_KEYS],
			[storage.mutedColor, MUTED_KEYS],
			[storage.channelColor, CHANNEL_KEYS],
			[storage.mentionColor, MENTION_KEYS],
			[storage.statusOnline, ONLINE_KEYS],
			[storage.statusIdle, IDLE_KEYS],
			[storage.statusDnd, DND_KEYS],
		];
		for (const [value, keys] of customs) {
			const hex = String(value ?? "").trim();
			if (!/^#[0-9a-f]{6}$/i.test(hex)) continue;
			for (const k of keys) {
				if (trySet(sc, k, hex)) applied.push(k);
			}
		}
	} catch { /* never break Discord over a color */ }
	lastApplied = applied;
	return applied;
}

let unpatchWallpaper: (() => void) | undefined;
let wallpaperSupported = false;
let resolvedChatView = "";

// The chat view's component name AND shape change between Discord versions
// (class vs memo vs forwardRef), so collect every patchable (object, key)
// pair across all known names instead of betting on one.
function chatViewCandidates(): { obj: any; key: string; via: string; }[] {
	const out: { obj: any; key: string; via: string; }[] = [];
	const push = (obj: any, key: string, via: string) => {
		try {
			if (!obj || typeof obj[key] !== "function") return;
			if (out.some(e => e.obj === obj && e.key === key)) return;
			out.push({ obj, key, via });
		} catch { /* ignore */ }
	};

	const names = ["MessagesConnected", "Messages", "ChatMessages", "MessageListConnected", "ConnectedMessages"];
	const holders: { h: any; via: string; }[] = [];
	for (const n of names) {
		const attempts: [string, () => any][] = [
			[`displayName:${n}`, () => findByDisplayName(n, false)],
			[`name:${n}`, () => findByName(n, false)],
			[`displayName:${n}#default`, () => findByDisplayName(n, true)],
			[`name:${n}#default`, () => findByName(n, true)],
		];
		for (const [via, get] of attempts) {
			try {
				const h = get();
				if (h) holders.push({ h, via });
			} catch { /* not found under this lookup */ }
		}
		try {
			const m = find((exp: any) => exp?.default?.displayName === n || exp?.displayName === n || exp?.default?.name === n);
			if (m) holders.push({ h: m, via: `scan:${n}` });
		} catch { /* keep looking */ }
	}

	for (const { h, via } of holders) {
		for (const o of [h, h?.default, h?.type, h?.default?.type]) {
			if (!o) continue;
			if (o?.prototype?.render) push(o.prototype, "render", `${via}>class`);
			else if (typeof o?.render === "function") push(o, "render", `${via}>forwardRef`);
			else if (typeof o?.type === "function") push(o, "type", `${via}>memo`);
			if (typeof o?.default === "function") push(o, "default", `${via}>module`);
		}
	}
	return out;
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
	let RN: any;
	try {
		RN = ReactNative as any;
		if (!RN?.ImageBackground || !RN?.View) return;
	} catch {
		return;
	}
	const handler = (_: any, ret: any) => {
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
	};
	// First candidate that accepts the patch wins.
	for (const c of chatViewCandidates()) {
		try {
			unpatchWallpaper = after(c.key, c.obj, handler);
			resolvedChatView = c.via;
			wallpaperSupported = true;
			return;
		} catch { /* try next candidate */ }
	}
}

function Settings() {
	useProxy(storage);
	const [status, setStatus] = React.useState("");
	const [wpStatus, setWpStatus] = React.useState("");

	function describe(c: any, depth = 0): string {
		try {
			if (!c) return "missing";
			if (c?.prototype?.render) return "class-component";
			if (c?.$$typeof === Symbol.for("react.memo")) return `memo(${depth ? "..." : describe(c.type, 1)})`;
			if (c?.$$typeof === Symbol.for("react.forward_ref")) return "forwardRef";
			if (typeof c === "function") return "function-component";
			if (typeof c === "object") {
				const keys = Object.keys(c).slice(0, 3);
				if (keys.length === 1 && keys[0] === "default")
					return `module(default=${depth ? "..." : describe(c.default, 1)})`;
				return `object[${keys.join("|")}]`;
			}
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
		const fonts = applyFont();
		if (applied.length || fonts) {
			setStatus(`Applied ${applied.length} color key(s)${fonts ? ` + font (${fonts} families)` : ""}: ${applied.slice(0, 6).join(", ")}${applied.length > 6 ? "..." : ""}.`.replace(": .", "."));
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
			<FormSection title="Font">
				{FONT_PRESETS.map(f => (
					<FormRadioRow
						key={f.value}
						label={f.name}
						subLabel={f.value === "default" ? "No override" : f.value === "custom" ? "Use the family typed below" : f.value}
						selected={storage.font === f.value}
						onPress={() => {
							storage.font = f.value;
							reapply();
						}}
					/>
				))}
				<Text style={{ opacity: 0.7, marginHorizontal: 12, marginBottom: 4, marginTop: 8 }}>
					Custom family (e.g. a font you installed in your loader's Fonts page)
				</Text>
				<FormInput
					title=""
					placeholder="Family name"
					value={String(storage.customFont ?? "")}
					onChange={(v: string) => { storage.customFont = v; }}
				/>
				<FormRow
					label="Font status"
					subLabel={lastFontApplied
						? `Applied to ${lastFontApplied} font families. Reload Discord if some text keeps the old font.`
						: "Default font in use. If a preset shows no change, that family is missing on your device."}
				/>
			</FormSection>
			<FormSection title="Text & UI colors">
				<Text style={{ opacity: 0.7, marginHorizontal: 12, marginBottom: 4 }}>
					Hex colors (#rrggbb, empty = default). Tap Re-apply theme when done.
				</Text>
				<Text style={{ opacity: 0.7, marginHorizontal: 12, marginBottom: 4, marginTop: 8 }}>Main text</Text>
				<FormInput title="" placeholder="#dbdee1" value={String(storage.textColor ?? "")} onChange={(v: string) => { storage.textColor = v; }} />
				<Text style={{ opacity: 0.7, marginHorizontal: 12, marginBottom: 4, marginTop: 8 }}>Muted text</Text>
				<FormInput title="" placeholder="#949ba4" value={String(storage.mutedColor ?? "")} onChange={(v: string) => { storage.mutedColor = v; }} />
				<Text style={{ opacity: 0.7, marginHorizontal: 12, marginBottom: 4, marginTop: 8 }}>Channel names</Text>
				<FormInput title="" placeholder="#949ba4" value={String(storage.channelColor ?? "")} onChange={(v: string) => { storage.channelColor = v; }} />
				<Text style={{ opacity: 0.7, marginHorizontal: 12, marginBottom: 4, marginTop: 8 }}>Mentions & links</Text>
				<FormInput title="" placeholder="#5865f2" value={String(storage.mentionColor ?? "")} onChange={(v: string) => { storage.mentionColor = v; }} />
				<Text style={{ opacity: 0.7, marginHorizontal: 12, marginBottom: 4, marginTop: 8 }}>Status: online</Text>
				<FormInput title="" placeholder="#43b581" value={String(storage.statusOnline ?? "")} onChange={(v: string) => { storage.statusOnline = v; }} />
				<Text style={{ opacity: 0.7, marginHorizontal: 12, marginBottom: 4, marginTop: 8 }}>Status: idle</Text>
				<FormInput title="" placeholder="#faa61a" value={String(storage.statusIdle ?? "")} onChange={(v: string) => { storage.statusIdle = v; }} />
				<Text style={{ opacity: 0.7, marginHorizontal: 12, marginBottom: 4, marginTop: 8 }}>Status: do not disturb</Text>
				<FormInput title="" placeholder="#f04747" value={String(storage.statusDnd ?? "")} onChange={(v: string) => { storage.statusDnd = v; }} />
				<FormRow
					label="Apply colors"
					subLabel="Applies every hex value above"
					onPress={reapply}
				/>
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
					One family applies to every weight, so bold text uses the same font.
					For Google Fonts: install the font in your loader's Fonts page, then
					type its family name under Custom. Per-server wallpapers live in
					GuildStyler and override the one here.
				</Text>
			</FormSection>
		</ScrollView>
	);
}

export default {
	onLoad: () => {
		try { applyTheme(); } catch { }
		try { applyFont(); } catch { }
		patchWallpaper();
	},
	onUnload: () => {
		try { unpatchWallpaper?.(); } catch { }
		unpatchWallpaper = undefined;
		wallpaperSupported = false;
		resolvedChatView = "";
		try { restore(); } catch { }
		try { restoreFont(); } catch { }
	},
	settings: Settings,
};
