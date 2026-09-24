/*
 * Ported from Vencord's ClearURLs plugin (original authors: adryd, thororen)
 * Vencord is GPL-3.0-or-later; this mobile port is distributed under the same terms.
 * Desktop source: vencord/src/plugins/clearURLs
 *
 * Mobile adaptation: rules are fetched and applied to outgoing messages via
 * the send-message hook. Message edits are not covered on mobile (no stable
 * edit pipeline hook); sends are.
 */

import { findByProps } from "@vendetta/metro";
import { React, ReactNative } from "@vendetta/metro/common";
import { before } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";

storage.enabled ??= true;

const { ScrollView } = ReactNative;
const { FormSection, FormRow, FormSwitchRow } = Forms;

const CLEAR_URLS_JSON_URL = "https://raw.githubusercontent.com/ClearURLs/Rules/master/data.min.json";

interface Provider {
	urlPattern: string;
	completeProvider: boolean;
	rules?: string[];
	rawRules?: string[];
	referralMarketing?: string[];
	exceptions?: string[];
	redirections?: string[];
	forceRedirection?: boolean;
}

interface ClearUrlsData {
	providers: Record<string, Provider>;
}

interface RuleSet {
	name: string;
	urlPattern: RegExp;
	rules?: RegExp[];
	rawRules?: RegExp[];
	exceptions?: RegExp[];
}

let rules: RuleSet[] = [];
let rulesLoaded = false;
let loadError = "";
let unpatchSend: (() => void) | undefined;

async function createRules() {
	const res = await fetch(CLEAR_URLS_JSON_URL).then(r => r.json()) as ClearUrlsData;
	rules = [];
	for (const [name, provider] of Object.entries(res.providers)) {
		rules.push({
			name,
			urlPattern: new RegExp(provider.urlPattern, "i"),
			rules: provider.rules?.map(r => new RegExp(r, "i")),
			rawRules: provider.rawRules?.map(r => new RegExp(r, "i")),
			exceptions: provider.exceptions?.map(e => new RegExp(e, "i")),
		});
	}
	rulesLoaded = true;
}

function replacer(match: string): string {
	let url: URL;
	try {
		url = new URL(match);
	} catch {
		return match;
	}
	if (url.searchParams.entries().next().done) return match;

	for (const { urlPattern, exceptions, rawRules, rules: rs } of rules) {
		if (!urlPattern.test(url.href) || exceptions?.some(ex => ex.test(url.href))) continue;
		const toDelete: string[] = [];
		if (rs) {
			url.searchParams.forEach((_, param) => {
				if (rs.some(rule => rule.test(param))) toDelete.push(param);
			});
		}
		toDelete.forEach(param => url.searchParams.delete(param));
		let cleanedUrl = url.href;
		rawRules?.forEach(rawRule => {
			cleanedUrl = cleanedUrl.replace(rawRule, "");
		});
		url = new URL(cleanedUrl);
	}
	return url.toString();
}

function cleanContent(content: string): string {
	if (!storage.enabled || !rulesLoaded) return content;
	if (!/http(s)?:\/\//.test(content)) return content;
	return content.replace(
		/(https?:\/\/[^\s<]+[^<.,:;"'>)|\]\s])/g,
		match => replacer(match)
	);
}

function hookSend() {
	try {
		const msgMod = findByProps("sendMessage", "receiveMessage");
		if (!msgMod) return;
		unpatchSend = before("sendMessage", msgMod, (args: any[]) => {
			try {
				for (const a of args) {
					if (a && typeof a === "object" && typeof a.content === "string" && a.content) {
						const cleaned = cleanContent(a.content);
						if (cleaned !== a.content) a.content = cleaned;
						break;
					}
				}
			} catch { /* never block sending */ }
		});
	} catch { /* message module missing on this version */ }
}

function Settings() {
	useProxy(storage);
	const [status, setStatus] = React.useState("");

	React.useEffect(() => {
		if (rulesLoaded) setStatus(`Tracking rules loaded (${rules.length} providers).`);
		else if (loadError) setStatus(`Rule download failed: ${loadError}`);
	}, []);

	return (
		<ScrollView style={{ flex: 1 }}>
			<FormSection title="ClearURLs">
				<FormSwitchRow
					label="Enabled"
					subLabel="Strip tracking parameters from links you send"
					value={!!storage.enabled}
					onValueChange={v => { storage.enabled = v; }}
				/>
				<FormRow
					label="Rules status"
					subLabel={rulesLoaded
						? `Loaded (${rules.length} providers from ClearURLs upstream).`
						: loadError
							? `Failed: ${loadError}`
							: "Downloading rules..."}
				/>
				<FormRow
					label="Reload rules"
					subLabel="Re-download the tracking-parameter list"
					onPress={() => {
						loadError = "";
						setStatus("Downloading rules...");
						createRules()
							.then(() => setStatus(`Tracking rules loaded (${rules.length} providers).`))
							.catch((e: any) => {
								loadError = e instanceof Error ? e.message : String(e);
								setStatus(`Rule download failed: ${loadError}`);
							});
					}}
				/>
				{!!status && (
					<FormRow label="Status" subLabel={status} />
				)}
			</FormSection>
		</ScrollView>
	);
}

export default {
	onLoad: () => {
		hookSend();
		createRules().catch((e: any) => {
			loadError = e instanceof Error ? e.message : String(e);
		});
	},
	onUnload: () => {
		try { unpatchSend?.(); } catch { }
		unpatchSend = undefined;
		rules = [];
		rulesLoaded = false;
	},
	settings: Settings,
};
