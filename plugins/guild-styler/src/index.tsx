import { findByName, findByStoreName } from "@vendetta/metro";
import { React, ReactNative } from "@vendetta/metro/common";
import { after } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { semanticColors } from "@vendetta/ui";
import { Button, Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";
import { findInReactTree } from "@vendetta/utils";

// Mobile companion to DiscordStyler: per-server accents and wallpapers
// applied to the same runtime layers. Servers without a mapping keep your
// global DiscordStyler setup.

storage.enabled ??= true;
storage.maps ??= {};
storage.wallpaperDim ??= "0.4";
storage.wallpaperBlur ??= "0";

const { ScrollView, Text } = ReactNative;
const { FormSection, FormRow, FormInput, FormSwitchRow } = Forms;
// vendetta-types ships its own React types; Button misaligns with them, so
// treat it as untyped (runtime is unaffected).
const AnyButton = Button as any;

const BRAND_KEYS = ["BRAND_500", "BRAND_560", "BRAND_600"];

interface GuildMap {
	name: string;
	accent?: string;
	wallpaper?: string;
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
let unpatchWallpaper: (() => void) | undefined;

function num(v: unknown, fb: number): number {
	const n = Number(v);
	return Number.isFinite(n) ? n : fb;
}

function currentWallpaper(): string {
	try {
		if (!storage.enabled) return "";
		const id = currentGuild().id;
		if (!id) return "";
		return String(readMaps()[id]?.wallpaper ?? "").trim();
	} catch {
		return "";
	}
}

function GuildWallpaper({ children }: { children: React.ReactNode; }) {
	const uri = currentWallpaper();
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
	try {
		const RN = ReactNative as any;
		if (!RN?.ImageBackground || !RN?.View) return;
		const Messages = findByName("MessagesConnected");
		if (!Messages?.prototype?.render) return;
		unpatchWallpaper = after("render", Messages.prototype, (_: any, ret: any) => {
			try {
				if (!currentWallpaper()) return ret;
				const node = findInReactTree(ret, (t: any) => t?.props && "HACK_fixModalInteraction" in t.props && t.props.style);
				if (node?.props) {
					node.props.style = [node.props.style, { backgroundColor: "transparent" }];
				}
				return <GuildWallpaper>{ret}</GuildWallpaper>;
			} catch {
				return ret;
			}
		});
	} catch { /* chat view unavailable on this version */ }
}

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
	const [wurl, setWurl] = React.useState("");
	const [status, setStatus] = React.useState("");
	const g = currentGuild();
	const maps = readMaps();
	const ids = Object.keys(maps);
	const existing = g.id ? maps[g.id] : undefined;

	function save() {
		if (!g.id) {
			setStatus("Open a server first.");
			return;
		}
		const accent = hex.trim();
		const wallpaper = wurl.trim();
		if (accent && !/^#[0-9a-f]{6}$/i.test(accent)) {
			setStatus("Accent must look like #43b581 (or leave it empty).");
			return;
		}
		if (!accent && !wallpaper) {
			setStatus("Enter an accent and/or a wallpaper URL first.");
			return;
		}
		storage.maps = {
			...maps,
			[g.id]: {
				name: g.name,
				accent: accent || existing?.accent,
				wallpaper: wallpaper || existing?.wallpaper,
			},
		};
		setHex("");
		setWurl("");
		const ok = applyForGuild(g.id);
		setStatus(`Saved style for ${g.name}.${ok ? "" : " Accent keys were not patchable on this version."} Switch channels to refresh the wallpaper.`);
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
				{existing && (
					<FormRow
						label="Saved style"
						subLabel={`${existing.accent ?? "no accent"}${existing.wallpaper ? " + wallpaper" : ""}`}
					/>
				)}
				<Text style={{ opacity: 0.7, marginHorizontal: 12, marginBottom: 4 }}>
					Hex accent for the current server (e.g. #43b581, empty = keep saved)
				</Text>
				<FormInput
					title=""
					placeholder="#43b581"
					value={hex}
					onChange={setHex}
				/>
				<Text style={{ opacity: 0.7, marginHorizontal: 12, marginBottom: 4, marginTop: 8 }}>
					Wallpaper image URL for this server (empty = keep saved)
				</Text>
				<FormInput
					title=""
					placeholder="https://.../server-wallpaper.jpg"
					value={wurl}
					onChange={setWurl}
				/>
				<FormRow label="Save style for this server" onPress={save} />
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
						subLabel={`${maps[id]?.accent ?? "no accent"}${maps[id]?.wallpaper ? " + wallpaper" : ""}`}
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
		patchWallpaper();
	},
	onUnload: () => {
		try { unsubscribe?.(); } catch { }
		unsubscribe = undefined;
		try { unpatchWallpaper?.(); } catch { }
		unpatchWallpaper = undefined;
		try { restore(); } catch { }
	},
	settings: Settings,
};
