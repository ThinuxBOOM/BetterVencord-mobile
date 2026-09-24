import { React, ReactNative } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { semanticColors } from "@vendetta/ui";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

// Mobile has no DOM/CSS cascade, so the desktop wallpaper/font engine cannot
// run here. This port covers what IS patchable at runtime: the accent scale
// and background colors. Wallpapers, fonts and full themes belong in your
// loader's Themes page (a Revenge/Vendetta theme JSON).

storage.accent ??= "default";
storage.amoled ??= false;

const { ScrollView, Text } = ReactNative;
const { FormSection, FormRow, FormRadioRow, FormSwitchRow } = Forms;

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

function Settings() {
	useProxy(storage);
	const [status, setStatus] = React.useState("");

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
			<FormSection title="Mobile notes">
				<Text style={{ opacity: 0.7, marginHorizontal: 12, marginVertical: 6 }}>
					Wallpapers, fonts and transparency need a full theme: install one from your loader's Themes page.
					This plugin only overrides accent and background colors, best-effort per Discord version.
				</Text>
			</FormSection>
		</ScrollView>
	);
}

export default {
	onLoad: () => { try { applyTheme(); } catch { } },
	onUnload: () => { try { restore(); } catch { } },
	settings: Settings,
};
