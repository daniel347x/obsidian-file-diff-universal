import { Plugin, TFile, Notice } from 'obsidian';

import {
	DifferencesView,
	VIEW_TYPE_DIFFERENCES,
	ViewState,
} from './components/differences_view';
import { RiskyActionModal } from './components/modals/risky_action_modal';
import { SelectFileModal } from './components/modals/select_file_modal';

export default class FileDiffPlugin extends Plugin {
	fileDiffMergeWarningKey = 'file-diff-merge-warning';
	
	// Hardcoded vault-relative path for diff spec files (at vault root)
	readonly DIFF_SPEC_BASE_PATH = 'temp/obsidian-diff/diff-spec-';

	override onload(): void {
		this.registerView(
			VIEW_TYPE_DIFFERENCES,
			(leaf) => new DifferencesView(leaf)
		);

		this.addCommand({
			id: 'compare',
			name: 'Compare',
			checkCallback: (checking: boolean) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile == null) {
					return false;
				}

				if (!checking) {
					this.getFileToCompare(activeFile).then(compareFile => {
						if (compareFile == null) {
							return;
						}

						this.openDifferencesView({
							file1: activeFile,
							file2: compareFile,
							showMergeOption: false,
						});
					});
				}

				return true;
			},
		});

		this.addCommand({
			id: 'compare-and-merge',
			name: 'Compare and merge',
			checkCallback: (checking: boolean) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile == null) {
					return false;
				}

				if (!checking) {
					// Show warning when this option is selected for the first time
					const proceedWithMerge = async () => {
						if (!localStorage.getItem(this.fileDiffMergeWarningKey)) {
							await this.showRiskyActionModal();
							if (!localStorage.getItem(this.fileDiffMergeWarningKey)) {
								return;
							}
						}

						const compareFile = await this.getFileToCompare(activeFile);
						if (compareFile == null) {
							return;
						}

						this.openDifferencesView({
							file1: activeFile,
							file2: compareFile,
							showMergeOption: true,
						});
					};

					proceedWithMerge();
				}

				return true;
			},
		});

		this.addCommand({
			id: 'find-sync-conflicts-and-merge',
			name: 'Find sync conflicts and merge',
			callback: async () => {
				// Show warning when this option is selected for the first time
				if (!localStorage.getItem(this.fileDiffMergeWarningKey)) {
					await this.showRiskyActionModal();
					if (!localStorage.getItem(this.fileDiffMergeWarningKey)) {
						return;
					}
				}

				const syncConflicts = this.findSyncConflicts();

				for await (const syncConflict of syncConflicts) {
					const continuePromise = new Promise<boolean>((resolve) => {
						this.openDifferencesView({
							file1: syncConflict.originalFile,
							file2: syncConflict.syncConflictFile,
							showMergeOption: true,
							continueCallback: async (shouldContinue: boolean) =>
								resolve(shouldContinue),
						});
					});

					const shouldContinue = await continuePromise;
					if (!shouldContinue) {
						break;
					}
				}
			},
		});

		// Add 10 indexed compare commands (Index 0-9)
		for (let i = 0; i < 10; i++) {
			this.addCommand({
				id: `compare-indexed-${i}`,
				name: `Compare (Index ${i})`,
				callback: async () => {
					try {
						// Read diff spec from vault-relative path (at vault root)
						const specPath = `${this.DIFF_SPEC_BASE_PATH}${i}.json`;
						
						console.log(`[File Diff Index ${i}] Reading spec from: ${specPath}`);
						new Notice(`File Diff Index ${i}: Loading spec...`);
						
						const specContent = await this.app.vault.adapter.read(specPath);
						const spec = JSON.parse(specContent);
						
						console.log(`[File Diff Index ${i}] Spec loaded:`, spec);
						new Notice(`File Diff Index ${i}: Files loaded`);

						// Get TFile objects from vault-relative paths
						const file1 = this.app.vault.getAbstractFileByPath(spec.file1);
						const file2 = this.app.vault.getAbstractFileByPath(spec.file2);

						console.log(`[File Diff Index ${i}] file1:`, file1);
						console.log(`[File Diff Index ${i}] file2:`, file2);

						if (!file1) {
							new Notice(`File Diff Index ${i}: ERROR - File 1 not found: ${spec.file1}`, 5000);
							console.error(`[File Diff Index ${i}] File 1 not found:`, spec.file1);
							return;
						}

						if (!file2) {
							new Notice(`File Diff Index ${i}: ERROR - File 2 not found: ${spec.file2}`, 5000);
							console.error(`[File Diff Index ${i}] File 2 not found:`, spec.file2);
							return;
						}

						new Notice(`File Diff Index ${i}: Opening diff view...`);

						// Open diff view directly (no modal)
						this.openDifferencesView({
							file1: file1 as TFile,
							file2: file2 as TFile,
							showMergeOption: false,
						});

						console.log(`[File Diff Index ${i}] Diff view opened successfully`);
						new Notice(`File Diff Index ${i}: Success!`, 3000);
						
					} catch (error) {
						new Notice(`File Diff Index ${i}: ERROR - ${error.message}`, 5000);
						console.error(`[File Diff Index ${i}] Failed:`, error);
					}
				},
			});
		}
	}

	override async onunload(): Promise<void> {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_DIFFERENCES);
	}

	private getFileToCompare(activeFile: TFile): Promise<TFile | undefined> {
		const selectableFiles = this.app.vault.getFiles();
		selectableFiles.remove(activeFile);
		return this.showSelectOtherFileModal({ selectableFiles });
	}

	private showSelectOtherFileModal(args: {
		selectableFiles: TFile[];
	}): Promise<TFile | undefined> {
		return new Promise((resolve, reject) => {
			new SelectFileModal({
				selectableFiles: args.selectableFiles,
				onChoose: (e, f) => (e ? reject(e) : resolve(f)),
			}).open();
		});
	}

	private showRiskyActionModal(): Promise<void> {
		return new Promise((resolve, reject) => {
			new RiskyActionModal({
				onAccept: async (e: Error | null) => {
					if (e) {
						reject(e);
					} else {
						localStorage.setItem(
							this.fileDiffMergeWarningKey,
							'true'
						);
						// Wait for the set item dispatch event to be processed
						await sleep(50);

						resolve();
					}
				},
			}).open();
		});
	}

	async openDifferencesView(state: ViewState): Promise<void> {
		// Closes all leafs (views) of the type VIEW_TYPE_DIFFERENCES
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_DIFFERENCES);

		// Opens a new leaf (view) of the type VIEW_TYPE_DIFFERENCES
		const leaf = this.app.workspace.getLeaf(true);
		leaf.setViewState({
			type: VIEW_TYPE_DIFFERENCES,
			active: true,
			state,
		});
		this.app.workspace.revealLeaf(leaf);
	}

	findSyncConflicts(): { originalFile: TFile; syncConflictFile: TFile }[] {
		const syncConflicts: {
			originalFile: TFile;
			syncConflictFile: TFile;
		}[] = [];

		const files = app.vault.getMarkdownFiles();

		for (const file of files) {
			if (file.name.includes('sync-conflict')) {
				const originalFileName = file.name.replace(
					/\.sync-conflict-\d{8}-\d{6}-[A-Z0-9]+/,
					''
				);
				const originalFile = files.find(
					(f) => f.name === originalFileName && (file.parent?.path ?? "") === (f.parent?.path ?? "")
				);

				if (originalFile) {
					syncConflicts.push({
						originalFile,
						syncConflictFile: file,
					});
				}
			}
		}

		return syncConflicts;
	}
}
