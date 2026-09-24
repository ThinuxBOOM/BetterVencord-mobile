import { findByProps, findByStoreName } from "@vendetta/metro";
import { React, ReactNative } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";

storage.scanLimit ??= "1000";

const { ScrollView, Text } = ReactNative;
const { FormSection, FormRow, FormInput } = Forms;

interface Msg {
	id: string;
	content: string;
	timestamp: string;
	author?: { username?: string; global_name?: string | null; bot?: boolean; };
	attachments?: unknown[];
}

interface Report {
	total: number;
	mine: number;
	attachments: number;
	avgLen: number;
	topAuthors: [string, number][];
	topWords: [string, number][];
	topDays: [string, number][];
}

const STOP = new Set(("the,and,you,that,for,with,have,this,from,they,say,her,she,will,one,all,would,there,their,what,about,which,when,make,like,just,look,more,these,than,into,your,has,its,our,out,are,was,were,been,can,who,not,but,had,has,have,does,did,will,no,yes,ok,yeah,lol,lmao,bruh,https,http,www,com,discord,tenor,giphy,gif,emoji").split(","));

async function apiGet(url: string): Promise<any> {
	const h = findByProps("getAPIBaseURL", "get");
	if (!h) throw new Error("Discord HTTP module not found on this version.");
	const res = await h.get({ url });
	return res?.body;
}

function currentChannelId(): string {
	try {
		return findByStoreName("SelectedChannelStore")?.getChannelId?.() ?? "";
	} catch {
		return "";
	}
}

function analyze(msgs: Msg[], myName: string): Report {
	const authors = new Map<string, number>();
	const words = new Map<string, number>();
	const days = new Map<string, number>();
	let chars = 0;
	let mine = 0;
	let attachments = 0;
	for (const m of msgs) {
		const who = m.author?.global_name || m.author?.username || "unknown";
		authors.set(who, (authors.get(who) ?? 0) + 1);
		if (myName && who === myName) mine++;
		chars += (m.content || "").length;
		attachments += (m.attachments || []).length;
		const day = new Date(m.timestamp).toLocaleDateString();
		days.set(day, (days.get(day) ?? 0) + 1);
		for (const w of (m.content || "").toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/[^a-z0-9' ]/g, " ").split(/\s+/)) {
			if (w.length > 3 && !STOP.has(w)) words.set(w, (words.get(w) ?? 0) + 1);
		}
	}
	const top = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
	return {
		total: msgs.length, mine, attachments,
		avgLen: msgs.length ? Math.round(chars / msgs.length) : 0,
		topAuthors: top(authors, 5), topWords: top(words, 12), topDays: top(days, 7),
	};
}

function Settings() {
	useProxy(storage);
	const [status, setStatus] = React.useState("");
	const [busy, setBusy] = React.useState(false);
	const [report, setReport] = React.useState<Report | null>(null);

	async function run() {
		if (busy) return;
		const channelId = currentChannelId();
		if (!channelId) {
			setStatus("Open a channel first.");
			return;
		}
		setBusy(true);
		setReport(null);
		setStatus("Scanning: 0");
		try {
			const cap = Math.max(100, Math.min(2000, Number(storage.scanLimit) || 1000));
			const out: Msg[] = [];
			let before: string | undefined;
			while (out.length < cap) {
				const page = await apiGet(`/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ""}`);
				const arr = (Array.isArray(page) ? page : []) as Msg[];
				if (arr.length === 0) break;
				out.push(...arr);
				setStatus(`Scanning: ${out.length}`);
				if (arr.length < 100) break;
				before = arr[arr.length - 1].id;
				await new Promise(r => setTimeout(r, 250));
			}
			let myName = "";
			try {
				const me = await apiGet("/users/@me");
				myName = me?.global_name || me?.username || "";
			} catch { /* stats still work, "mine" just stays 0 */ }
			setReport(analyze(out, myName));
			setStatus(`Scanned ${out.length} messages. Nothing leaves your device.`);
		} catch (e) {
			setStatus(e instanceof Error ? e.message : "Scan failed.");
		} finally {
			setBusy(false);
		}
	}

	const line = ([k, v]: [string, number], i: number) => (
		<Text key={`${i}-${k}`} style={{ marginHorizontal: 12, marginVertical: 1 }}>
			{k}: {v}
		</Text>
	);

	return (
		<ScrollView style={{ flex: 1 }}>
			<FormSection title="Channel analytics">
				<FormRow
					label={busy ? "Scanning..." : "Scan current channel"}
					subLabel="Local-only analytics for the open channel"
					onPress={run}
				/>
				{!!status && (
					<FormRow label="Status" subLabel={status} />
				)}
			</FormSection>
			<FormSection title="Options">
				<Text style={{ opacity: 0.7, marginHorizontal: 12, marginBottom: 4 }}>
					Max messages to scan (cap 2000 on mobile)
				</Text>
				<FormInput
					title=""
					placeholder="1000"
					value={String(storage.scanLimit ?? "")}
					onChange={(v: string) => { storage.scanLimit = v.replace(/[^0-9]/g, ""); }}
				/>
			</FormSection>
			{report && (
				<>
					<FormSection title="Totals">
						<FormRow label="Messages" subLabel={String(report.total)} />
						<FormRow label="Yours" subLabel={String(report.mine)} />
						<FormRow label="Attachments" subLabel={String(report.attachments)} />
						<FormRow label="Avg length" subLabel={String(report.avgLen)} />
					</FormSection>
					<FormSection title="Top authors">
						{report.topAuthors.map(line)}
					</FormSection>
					<FormSection title="Top words">
						{report.topWords.map(line)}
					</FormSection>
					<FormSection title="Busiest days">
						{report.topDays.map(line)}
					</FormSection>
				</>
			)}
		</ScrollView>
	);
}

export default {
	settings: Settings,
};
