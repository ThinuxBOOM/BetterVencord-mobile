import { React, ReactNative, clipboard } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { showConfirmationAlert } from "@vendetta/ui/alerts";
import { Button, Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

// On mobile there are no theme *files*: themes install from URLs, so the
// vault backs up your theme *links* plus this plugin's own settings.
// (For a full app backup, use your loader's built-in backup feature.)

storage.themeUrls ??= [];

const { ScrollView, Text } = ReactNative;
const { FormSection, FormRow, FormInput } = Forms;
// vendetta-types ships its own React types; Button misaligns with them, so
// treat it as untyped (runtime is unaffected).
const AnyButton = Button as any;

interface Vault {
	version: 1;
	exportedAt: string;
	themeUrls: string[];
}

function readUrls(): string[] {
	return Array.isArray(storage.themeUrls) ? storage.themeUrls as string[] : [];
}

function Settings() {
	useProxy(storage);
	const [status, setStatus] = React.useState("");
	const [newUrl, setNewUrl] = React.useState("");
	const [importText, setImportText] = React.useState("");
	const urls = readUrls();

	function addUrl() {
		const u = newUrl.trim();
		if (!u) return;
		if (!/^https?:\/\//i.test(u)) {
			setStatus("That does not look like an http(s) URL.");
			return;
		}
		if (urls.includes(u)) {
			setStatus("That URL is already saved.");
			return;
		}
		storage.themeUrls = [...urls, u];
		setNewUrl("");
		setStatus(`Saved theme link (${urls.length + 1} total).`);
	}

	function removeUrl(u: string) {
		storage.themeUrls = readUrls().filter(x => x !== u);
		setStatus("Removed theme link.");
	}

	function copyUrl(u: string) {
		try {
			clipboard.setString(u);
			showToast("Theme link copied");
		} catch {
			setStatus("Copy failed (clipboard unavailable).");
		}
	}

	function exportAll() {
		try {
			const vault: Vault = {
				version: 1,
				exportedAt: new Date().toISOString(),
				themeUrls: readUrls(),
			};
			clipboard.setString(JSON.stringify(vault, null, 2));
			setStatus(`Backup copied to clipboard (${vault.themeUrls.length} theme link(s)). Paste it into Notes to keep it.`);
			showToast("Backup copied to clipboard");
		} catch {
			setStatus("Export failed (clipboard unavailable).");
		}
	}

	function importAll() {
		const raw = importText.trim();
		if (!raw) {
			setStatus("Paste a backup JSON first.");
			return;
		}
		let vault: Vault;
		try {
			vault = JSON.parse(raw) as Vault;
		} catch {
			setStatus("That is not valid JSON.");
			return;
		}
		if (!vault || vault.version !== 1 || !Array.isArray(vault.themeUrls)) {
			setStatus("That file is not a SettingsVault backup.");
			return;
		}
		const doImport = () => {
			storage.themeUrls = vault.themeUrls.filter(u => typeof u === "string");
			setImportText("");
			setStatus(`Restored ${storage.themeUrls.length} theme link(s). Re-install them from your Themes page.`);
			showToast("Backup restored");
		};
		try {
			showConfirmationAlert({
				title: "Restore backup?",
				content: `This replaces your saved theme links with ${vault.themeUrls.length} link(s) from the backup.`,
				confirmText: "Restore",
				cancelText: "Cancel",
				onConfirm: doImport,
			});
		} catch {
			doImport();
		}
	}

	return (
		<ScrollView style={{ flex: 1 }}>
			<FormSection title="Backup">
				<FormRow
					label="Export backup"
					subLabel="Copy theme links + settings to clipboard as JSON"
					onPress={exportAll}
				/>
				<Text style={{ opacity: 0.7, marginHorizontal: 12, marginBottom: 4 }}>
					Paste a backup JSON below, then tap Import.
				</Text>
				<FormInput
					title=""
					placeholder='Paste {"version": 1, ...} here'
					value={importText}
					onChange={setImportText}
				/>
				<FormRow
					label="Import backup"
					subLabel="Restore theme links from pasted JSON"
					onPress={importAll}
				/>
				{!!status && (
					<FormRow label="Status" subLabel={status} />
				)}
			</FormSection>
			<FormSection title={`Theme links (${urls.length})`}>
				<Text style={{ opacity: 0.7, marginHorizontal: 12, marginBottom: 4 }}>
					Mobile themes install from URLs. Keep your links here so you never lose them.
				</Text>
				<FormInput
					title=""
					placeholder="https://.../my-theme.json"
					value={newUrl}
					onChange={setNewUrl}
				/>
				<FormRow label="Save theme link" subLabel="Add the URL above" onPress={addUrl} />
				{urls.map(u => (
					<FormRow
						key={u}
						label={u.length > 48 ? `${u.slice(0, 48)}...` : u}
						subLabel="Tap to copy link"
						onPress={() => copyUrl(u)}
						trailing={() => (
							<AnyButton
								text="Remove"
								color="red"
								size="small"
								onPress={() => removeUrl(u)}
							/>
						)}
					/>
				))}
			</FormSection>
		</ScrollView>
	);
}

export default {
	settings: Settings,
};
