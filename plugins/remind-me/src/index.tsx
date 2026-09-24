import { findByProps } from "@vendetta/metro";
import { React, ReactNative } from "@vendetta/metro/common";
import { after, before } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { findInReactTree } from "@vendetta/utils";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

storage.defaultMinutes ??= "60";
storage.reminders ??= [];

const { ScrollView, Text } = ReactNative;
const { FormSection, FormRow, FormInput } = Forms;

interface Reminder {
	id: string;
	channelId: string;
	messageId: string;
	snippet: string;
	author: string;
	dueAt: number;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const patches: (() => void)[] = [];

function readAll(): Reminder[] {
	return Array.isArray(storage.reminders) ? storage.reminders as Reminder[] : [];
}

function persist(list: Reminder[]) {
	storage.reminders = list;
}

function fmtDue(dueAt: number): string {
	const ms = dueAt - Date.now();
	if (ms <= 0) return "due";
	const m = Math.round(ms / 60000);
	if (m < 60) return `in ${m}m`;
	const h = Math.floor(m / 60);
	if (h < 48) return `in ${h}h${m % 60 ? ` ${m % 60}m` : ""}`;
	return new Date(dueAt).toLocaleString();
}

function fire(r: Reminder) {
	timers.delete(r.id);
	persist(readAll().filter(x => x.id !== r.id));
	try {
		showToast(`Reminder from ${r.author}: ${r.snippet}`);
	} catch { /* reminder still cleared */ }
}

function arm(r: Reminder) {
	disarm(r.id);
	const delay = r.dueAt - Date.now();
	if (delay <= 0) {
		fire(r);
		return;
	}
	timers.set(r.id, setTimeout(() => fire(r), Math.min(delay, 2147483647)));
}

function disarm(id: string) {
	const t = timers.get(id);
	if (t) {
		clearTimeout(t);
		timers.delete(id);
	}
}

export function addReminder(channelId: string, messageId: string, snippet: string, author: string, minutes: number) {
	const mins = Math.max(1, Math.min(60 * 24 * 30, Math.round(minutes) || 60));
	const r: Reminder = {
		id: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
		channelId, messageId,
		snippet: snippet.slice(0, 140) || "(image/attachment)",
		author, dueAt: Date.now() + mins * 60000,
	};
	persist([...readAll(), r]);
	arm(r);
	try {
		showToast(`Reminder set ${fmtDue(r.dueAt)}.`);
	} catch { /* fine */ }
}

function patchActionSheet() {
	try {
		const LazyActionSheet = findByProps("openLazy", "hideActionSheet");
		if (!LazyActionSheet) return;
		const RowComponent = (findByProps("ActionSheetRow") as any)?.ActionSheetRow ?? Forms.FormRow;

		patches.push(before("openLazy", LazyActionSheet, ([component, key, msg]: any[]) => {
			const message = msg?.message;
			if (key !== "MessageLongPressActionSheet" || !message) return;

			component.then((instance: any) => {
				const unpatch = after("default", instance, (_: any, comp: any) => {
					React.useEffect(() => () => { unpatch(); }, []);

					const groups: any[] = findInReactTree(
						comp,
						(c: any) => Array.isArray(c) && c[0]?.type?.name === "ActionSheetRowGroup"
					);
					if (!groups?.length) return;

					const msgObj = message;
					const snippet = String(msgObj?.content ?? "");
					const author = String(msgObj?.author?.global_name || msgObj?.author?.username || "someone");
					const channelId = String(msgObj?.channel_id ?? "");
					const messageId = String(msgObj?.id ?? "");
					if (!channelId || !messageId) return;

					const quickMins = Number(storage.defaultMinutes) || 60;
					const quickLabel = quickMins >= 60
						? `Remind me in ${Math.round(quickMins / 60 * 10) / 10}h`
						: `Remind me in ${quickMins}m`;

					const mkRow = (label: string, mins: number) =>
						React.createElement(RowComponent, {
							label,
							onPress: () => {
								try { LazyActionSheet.hideActionSheet(); } catch { }
								addReminder(channelId, messageId, snippet, author, mins);
							},
						});

					const rows = [mkRow(quickLabel, quickMins), mkRow("Remind me in 24h", 24 * 60)];

					for (const g of groups) {
						const groupChildren: any[] = findInReactTree(
							g,
							(c: any) => Array.isArray(c) && c.some((child: any) => child?.type?.name === "ActionSheetRow")
						);
						if (groupChildren) {
							groupChildren.unshift(...rows);
							return;
						}
					}
				});
			}).catch(() => { /* action sheet internals changed; settings panel still works */ });
		}));
	} catch { /* message long-press menu unavailable; settings panel still works */ }
}

function Settings() {
	useProxy(storage);
	const list = readAll().slice().sort((a, b) => a.dueAt - b.dueAt);

	function cancel(id: string) {
		disarm(id);
		persist(readAll().filter(x => x.id !== id));
	}

	return (
		<ScrollView style={{ flex: 1 }}>
			<FormSection title="Reminders">
				{list.length === 0 && (
					<Text style={{ opacity: 0.7, marginHorizontal: 12, marginVertical: 6 }}>
						No reminders. Long-press any message to set one.
					</Text>
				)}
				{list.map(r => (
					<FormRow
						key={r.id}
						label={`${r.author} - ${fmtDue(r.dueAt)}`}
						subLabel={r.snippet}
						onPress={() => cancel(r.id)}
					/>
				))}
				{list.length > 0 && (
					<Text style={{ opacity: 0.7, marginHorizontal: 12, marginVertical: 6 }}>
						Tap a reminder to cancel it.
					</Text>
				)}
			</FormSection>
			<FormSection title="Options">
				<Text style={{ opacity: 0.7, marginHorizontal: 12, marginBottom: 4 }}>
					Default delay for the quick reminder (minutes)
				</Text>
				<FormInput
					title=""
					placeholder="60"
					value={String(storage.defaultMinutes ?? "")}
					onChange={(v: string) => { storage.defaultMinutes = v.replace(/[^0-9]/g, ""); }}
				/>
			</FormSection>
		</ScrollView>
	);
}

export default {
	onLoad: () => {
		for (const r of readAll()) {
			try { arm(r); } catch { }
		}
		patchActionSheet();
	},
	onUnload: () => {
		for (const id of [...timers.keys()]) disarm(id);
		while (patches.length) {
			try { patches.pop()?.(); } catch { }
		}
	},
	settings: Settings,
};
