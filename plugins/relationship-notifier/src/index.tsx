/*
 * Ported from Vencord's RelationshipNotifier plugin (original author: nick).
 * Vencord is GPL-3.0-or-later; this mobile port is distributed under the same terms.
 * Desktop source: vencord/src/plugins/relationshipNotifier
 *
 * Mobile adaptation: instead of webpack patches on the remove/leave actions,
 * removals are detected by diffing store snapshots. Self-initiated removals
 * are suppressed with best-effort action hooks. Notifications are toasts
 * (mobile has no desktop notice bar / OS notification bridge here).
 */

import { findByProps, findByStoreName } from "@vendetta/metro";
import { React, ReactNative } from "@vendetta/metro/common";
import { before } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

storage.friends ??= true;
storage.friendRequestCancels ??= true;
storage.servers ??= true;
storage.groups ??= true;
storage.offlineRemovals ??= true;
storage.snap ??= null;

const { ScrollView, Text } = ReactNative;
const { FormSection, FormRow, FormSwitchRow } = Forms;

interface Snap {
	uid: string;
	guilds: { id: string; name: string; }[];
	groups: { id: string; name: string; }[];
	friends: string[];
	requests: string[];
}

let manuallyRemovedFriend: string | undefined;
let manuallyRemovedGuild: string | undefined;
let manuallyRemovedGroup: string | undefined;
let monitoring = false;
const cleanups: (() => void)[] = [];

function onCleanup(fn: () => void) {
	cleanups.push(fn);
}

function myId(): string {
	try {
		return findByStoreName("UserStore")?.getCurrentUser?.()?.id ?? "";
	} catch {
		return "";
	}
}

function userName(id: string): string {
	try {
		const u = findByStoreName("UserStore")?.getUser?.(id);
		const name = u?.global_name || u?.username;
		if (name) return String(name);
	} catch { /* fall through */ }
	return `user ${id.slice(-6)}`;
}

function currentSnapshot(): Snap | null {
	try {
		const uid = myId();
		if (!uid) return null;

		const guilds: Snap["guilds"] = [];
		try {
			const all = findByStoreName("GuildStore")?.getGuilds?.() ?? {};
			const MemberStore = findByStoreName("GuildMemberStore");
			for (const [id, g] of Object.entries(all as Record<string, any>)) {
				try {
					if (MemberStore?.isMember ? !MemberStore.isMember(id, uid) : false) continue;
				} catch { /* include on doubt */ }
				guilds.push({ id, name: String(g?.name ?? id) });
			}
		} catch { /* guilds unavailable */ }

		const groups: Snap["groups"] = [];
		try {
			const CS = findByStoreName("ChannelStore");
			const privates: any[] = CS?.getSortedPrivateChannels?.() ?? CS?.getPrivateChannels?.() ?? [];
			for (const c of privates) {
				// Group DMs only (type 3). DMs are type 1.
				if (c?.type === 3) {
					const name = c?.name || (c?.rawRecipients ?? []).map((r: any) => r?.username).filter(Boolean).join(", ") || "Unnamed group";
					groups.push({ id: String(c.id), name: String(name) });
				}
			}
		} catch { /* groups unavailable */ }

		const friends: string[] = [];
		const requests: string[] = [];
		try {
			const rels = findByStoreName("RelationshipStore")?.getMutableRelationships?.();
			const entries: [string, number][] = rels instanceof Map ? [...rels.entries()] : Object.entries(rels ?? {});
			for (const [id, type] of entries) {
				if (type === 1) friends.push(String(id));       // FRIEND
				else if (type === 3) requests.push(String(id));  // INCOMING_REQUEST
			}
		} catch { /* friends unavailable */ }

		return { uid, guilds, groups, friends, requests };
	} catch {
		return null;
	}
}

function notify(text: string) {
	try {
		showToast(text);
	} catch { /* best effort */ }
}

function diffAndNotify(old: Snap, cur: Snap) {
	try {
		if (storage.groups) {
			for (const g of old.groups) {
				if (manuallyRemovedGroup === g.id) {
					manuallyRemovedGroup = undefined;
					continue;
				}
				if (!cur.groups.some(x => x.id === g.id))
					notify(`You were removed from the group ${g.name}.`);
			}
		}
		if (storage.servers) {
			for (const g of old.guilds) {
				if (manuallyRemovedGuild === g.id) {
					manuallyRemovedGuild = undefined;
					continue;
				}
				if (!cur.guilds.some(x => x.id === g.id))
					notify(`You were removed from the server ${g.name}.`);
			}
		}
		if (storage.friends) {
			for (const id of old.friends) {
				if (manuallyRemovedFriend === id) {
					manuallyRemovedFriend = undefined;
					continue;
				}
				if (!cur.friends.includes(id))
					notify(`${userName(id)} removed you as a friend.`);
			}
		}
		if (storage.friendRequestCancels) {
			for (const id of old.requests) {
				if (!cur.requests.includes(id) && !cur.friends.includes(id))
					notify(`A friend request from ${userName(id)} was removed.`);
			}
		}
	} catch { /* never break store updates */ }
}

function check() {
	try {
		const cur = currentSnapshot();
		if (!cur) return;
		const old = storage.snap as Snap | null;
		if (old && old.uid === cur.uid) {
			diffAndNotify(old, cur);
		} else if (old && old.uid !== cur.uid) {
			// Account switched: re-baseline silently.
		} else if (!old && storage.offlineRemovals) {
			// First run ever: baseline silently (nothing to compare with).
		}
		(storage as any).snap = cur;
	} catch { /* best effort */ }
}

function watchStore(name: string) {
	try {
		const store = findByStoreName(name);
		if (store?.addChangeListener && store?.removeChangeListener) {
			const cb = () => {
				try { check(); } catch { }
			};
			store.addChangeListener(cb);
			onCleanup(() => {
				try { store.removeChangeListener(cb); } catch { }
			});
			return true;
		}
	} catch { /* store missing on this version */ }
	return false;
}

function hookSelfActions() {
	// Best-effort suppression of self-initiated removals (desktop patches the
	// same actions via webpack). Missing modules simply mean no suppression.
	try {
		const rel = findByProps("removeRelationship");
		if (rel) onCleanup(before("removeRelationship", rel, (args: any[]) => {
			try { manuallyRemovedFriend = String(args[0] ?? args[1] ?? ""); } catch { }
		}));
	} catch { /* ignore */ }
	try {
		const guilds = findByProps("leaveGuild");
		if (guilds) onCleanup(before("leaveGuild", guilds, (args: any[]) => {
			try { manuallyRemovedGuild = String(args[0] ?? ""); } catch { }
		}));
	} catch { /* ignore */ }
	try {
		const chan = findByProps("closePrivateChannel");
		if (chan) onCleanup(before("closePrivateChannel", chan, (args: any[]) => {
			try { manuallyRemovedGroup = String(args[0] ?? ""); } catch { }
		}));
	} catch { /* ignore */ }
}

function Settings() {
	useProxy(storage);
	const snap = storage.snap as Snap | null;

	return (
		<ScrollView style={{ flex: 1 }}>
			<FormSection title="Relationship notifier">
				<FormRow
					label="Status"
					subLabel={monitoring
						? "Watching friends, groups and servers for removals."
						: "Stores unavailable on this Discord version; monitoring is off."}
				/>
				{snap && (
					<FormRow
						label="Tracked"
						subLabel={`${snap.friends.length} friend(s), ${snap.requests.length} request(s), ${snap.guilds.length} server(s), ${snap.groups.length} group(s)`}
					/>
				)}
				<FormRow label="Check now" subLabel="Compare against the saved snapshot" onPress={() => { check(); notify("Relationship check done."); }} />
			</FormSection>
			<FormSection title="Notify me when">
				<FormSwitchRow label="A friend removes me" value={!!storage.friends} onValueChange={v => { storage.friends = v; }} />
				<FormSwitchRow label="A friend request is cancelled" value={!!storage.friendRequestCancels} onValueChange={v => { storage.friendRequestCancels = v; }} />
				<FormSwitchRow label="Removed from a server" value={!!storage.servers} onValueChange={v => { storage.servers = v; }} />
				<FormSwitchRow label="Removed from a group chat" value={!!storage.groups} onValueChange={v => { storage.groups = v; }} />
				<FormSwitchRow
					label="Check on startup"
					subLabel="Catch removals that happened while offline"
					value={!!storage.offlineRemovals}
					onValueChange={v => { storage.offlineRemovals = v; }}
				/>
			</FormSection>
			<FormSection title="Note">
				<Text style={{ opacity: 0.7, marginHorizontal: 12, marginVertical: 6 }}>
					Detection compares live data with a saved snapshot. Removals made by you are
					filtered when the action hooks resolve; otherwise tapping Check now after
					leaving something yourself may toast once.
				</Text>
			</FormSection>
		</ScrollView>
	);
}

export default {
	onLoad: () => {
		hookSelfActions();
		const watched = ["RelationshipStore", "GuildStore", "ChannelStore"]
			.map(watchStore)
			.some(Boolean);
		monitoring = watched;
		// Baseline first, then report offline removals on top of it.
		try {
			const cur = currentSnapshot();
			const old = storage.snap as Snap | null;
			if (cur && old && old.uid === cur.uid && storage.offlineRemovals) {
				diffAndNotify(old, cur);
			}
			if (cur) (storage as any).snap = cur;
		} catch { /* best effort */ }
		// Delayed second pass: stores populate shortly after start.
		setTimeout(() => {
			try { check(); } catch { }
		}, 8000);
	},
	onUnload: () => {
		while (cleanups.length) {
			try { cleanups.pop()?.(); } catch { }
		}
		monitoring = false;
		manuallyRemovedFriend = manuallyRemovedGuild = manuallyRemovedGroup = undefined;
	},
	settings: Settings,
};
