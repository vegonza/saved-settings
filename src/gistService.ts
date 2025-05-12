import * as vscode from 'vscode';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const GIST_ID_KEY = 'settingsSave.gistId';
// Define filenames for the Gist
const USER_SETTINGS_FILENAME = 'settings.json';
const KEYBINDINGS_FILENAME = 'keybindings.json';
const EXTENSIONS_FILENAME = 'extensions.json';

export class GistService {
    private static instance: GistService;
    private context: vscode.ExtensionContext;

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    public static getInstance(context: vscode.ExtensionContext): GistService {
        if (!GistService.instance) {
            GistService.instance = new GistService(context);
        }
        // Ensure context is updated if getInstance is called again with a different context
        GistService.instance.context = context;
        return GistService.instance;
    }

    // Helper function to get the VS Code user configuration directory path
    private getUserDataPath(): string {
        const platform = os.platform();
        // Read the fork folder name from configuration, default to 'Code'
        const extensionConfig = vscode.workspace.getConfiguration('settingsSave'); // Use the extension ID as section name
        const forkFolderName = extensionConfig.get<string>('forkFolderName')?.trim() || 'Code';

        if (!forkFolderName) {
            vscode.window.showWarningMessage('Fork folder name setting is empty, defaulting to "Code".');
            // Re-assign default in case trim resulted in empty string
            const defaultFolderName = 'Code';
            return this.getBaseUserDataPath(platform, defaultFolderName);
        }

        return this.getBaseUserDataPath(platform, forkFolderName);
    }

    // Helper to get the base path based on platform and folder name
    private getBaseUserDataPath(platform: string, folderName: string): string {
        switch (platform) {
            case 'win32':
                // Ensure APPDATA is available
                const appData = process.env.APPDATA;
                if (!appData) {
                    throw new Error('Environment variable APPDATA is not set.');
                }
                return path.join(appData, folderName, 'User');
            case 'darwin':
                return path.join(os.homedir(), 'Library', 'Application Support', folderName, 'User');
            case 'linux':
                return path.join(os.homedir(), '.config', folderName, 'User');
            default:
                throw new Error(`Unsupported platform: ${platform}`);
        }
    }

    // Helper function to read a user config file safely
    private readUserConfigFile(fileName: string): string | null {
        try {
            const filePath = path.join(this.getUserDataPath(), fileName);
            if (fs.existsSync(filePath)) {
                return fs.readFileSync(filePath, 'utf8');
            }
            return null; // File doesn't exist
        } catch (error) {
            console.error(`Error reading ${fileName}:`, error);
            vscode.window.showWarningMessage(`Could not read ${fileName}. It will not be included in the backup.`);
            return null;
        }
    }

    private async getGitHubToken(): Promise<string> {
        try {
            const session = await vscode.authentication.getSession('github', ['gist'], { createIfNone: true });
            if (session) {
                return session.accessToken;
            } else {
                throw new Error('GitHub authentication failed.');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`GitHub Authentication Error: ${error instanceof Error ? error.message : String(error)}`);
            throw error; // Re-throw the error to be caught by the command handler
        }
    }

    // Gets the content of settings.json
    private getUserSettingsContent(): string | null {
        return this.readUserConfigFile(USER_SETTINGS_FILENAME);
    }

    // Gets the content of keybindings.json
    private getKeybindingsContent(): string | null {
        return this.readUserConfigFile(KEYBINDINGS_FILENAME);
    }

    // Gets the list of installed (non-builtin) extensions
    private getInstalledExtensionsList(): string {
        const extensions = vscode.extensions.all
            .filter(extension => !extension.packageJSON.isBuiltin) // Filter out built-in extensions
            .map(extension => extension.id); // Get only the IDs
        return JSON.stringify(extensions, null, 2);
    }


    // --- Application Logic ---

    // Applies settings from the downloaded content
    private async applyUserSettings(settingsContent: string): Promise<void> {
        try {
            const settingsObject = JSON.parse(settingsContent);
            const config = vscode.workspace.getConfiguration();

            for (const key in settingsObject) {
                if (Object.prototype.hasOwnProperty.call(settingsObject, key)) {
                    const value = settingsObject[key];
                    // Use update method to apply settings globally (User scope)
                    // This is safer than overwriting settings.json directly
                    await config.update(key, value, vscode.ConfigurationTarget.Global);
                }
            }
            vscode.window.showInformationMessage('User settings applied successfully.');
        } catch (error) {
            console.error('Error applying user settings:', error);
            vscode.window.showErrorMessage(`Failed to apply user settings: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    // Applies keybindings by overwriting the keybindings.json file
    private async applyKeybindings(keybindingsContent: string): Promise<void> {
        try {
            const filePath = path.join(this.getUserDataPath(), KEYBINDINGS_FILENAME);
            fs.writeFileSync(filePath, keybindingsContent, 'utf8');
            vscode.window.showInformationMessage(`Keybindings written to ${KEYBINDINGS_FILENAME}. You might need to reload VS Code.`);
        } catch (error) {
            console.error('Error applying keybindings:', error);
            vscode.window.showErrorMessage(`Failed to write keybindings file: ${error instanceof Error ? error.message : 'Unknown error'}. Please check permissions.`);
        }
    }

    // Installs extensions from the downloaded list that are not already installed
    private async applyExtensions(extensionsContent: string): Promise<void> {
        try {
            const extensionsToInstall: string[] = JSON.parse(extensionsContent);
            const installedExtensions = vscode.extensions.all.map(ext => ext.id);
            const missingExtensions = extensionsToInstall.filter(id => !installedExtensions.includes(id));

            if (missingExtensions.length === 0) {
                vscode.window.showInformationMessage('All extensions from the backup are already installed.');
                return;
            }

            vscode.window.showInformationMessage(`Found ${missingExtensions.length} extensions to install...`);

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Installing Extensions",
                cancellable: false
            }, async (progress) => {
                for (let i = 0; i < missingExtensions.length; i++) {
                    const extensionId = missingExtensions[i];
                    progress.report({ message: `Installing ${extensionId}... (${i + 1}/${missingExtensions.length})`, increment: 100 / missingExtensions.length });
                    try {
                        await vscode.commands.executeCommand('workbench.extensions.install', extensionId);
                    } catch (installError) {
                        console.error(`Failed to install extension ${extensionId}:`, installError);
                        vscode.window.showWarningMessage(`Failed to install extension: ${extensionId}`);
                    }
                }
            });

            vscode.window.showInformationMessage('Extension installation process completed. Some installs might require a reload.');

        } catch (error) {
            console.error('Error applying extensions:', error);
            vscode.window.showErrorMessage(`Failed to apply extensions list: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    // Helper to determine the Gist ID to use (checks config first, then global state)
    private getEffectiveGistId(): string | undefined {
        const extensionConfig = vscode.workspace.getConfiguration('settingsSave');
        const configuredGistId = extensionConfig.get<string | null>('gistId');

        if (configuredGistId && configuredGistId.trim()) {
            console.log('Using Gist ID from configuration.');
            return configuredGistId.trim(); // Use Gist ID from settings if provided
        } else {
            console.log('Checking global state for Gist ID.');
            // Fallback to Gist ID stored in global state
            return this.context.globalState.get<string>(GIST_ID_KEY);
        }
    }

    // --- Upload/Download ---

    public async uploadSettings(): Promise<void> {
        let token: string;
        let effectiveGistId: string | undefined;
        try {
            token = await this.getGitHubToken();
            effectiveGistId = this.getEffectiveGistId(); // Use the helper function

            // Get content for each file
            const settingsContent = this.getUserSettingsContent();
            const keybindingsContent = this.getKeybindingsContent();
            const extensionsContent = this.getInstalledExtensionsList();

            // Build the files object for the Gist payload
            const files: { [key: string]: { content: string } } = {};
            if (settingsContent !== null) {
                files[USER_SETTINGS_FILENAME] = { content: settingsContent };
            }
            if (keybindingsContent !== null) {
                files[KEYBINDINGS_FILENAME] = { content: keybindingsContent };
            }
            // Always include extensions, even if empty list
            files[EXTENSIONS_FILENAME] = { content: extensionsContent };

            if (Object.keys(files).length === 0) {
                vscode.window.showWarningMessage("No settings, keybindings, or extensions found to upload.");
                return;
            }

            const headers = {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            };

            const gistPayload = {
                description: 'VS Code Settings Backup (settings, keybindings, extensions)',
                files: files
            };

            if (effectiveGistId) { // Use the determined Gist ID
                // Update existing Gist
                vscode.window.showInformationMessage(`Updating existing Gist: ${effectiveGistId}...`);
                await axios.patch(`https://api.github.com/gists/${effectiveGistId}`, gistPayload, { headers });
                vscode.window.showInformationMessage('Configurations successfully uploaded to existing Gist!');
            } else {
                // Create new Gist
                vscode.window.showInformationMessage('No Gist ID found in config or state. Creating a new Gist...');
                const response = await axios.post('https://api.github.com/gists', gistPayload, { headers });
                const newGistId = response.data.id;
                // Store the newly created Gist ID *only in global state*
                await this.context.globalState.update(GIST_ID_KEY, newGistId);
                vscode.window.showInformationMessage(`Configurations successfully uploaded to new Gist: ${newGistId}. ID stored for future use.`);
            }
        } catch (error: any) {
            console.error('Error uploading configurations:', error);
            const errorMessage = error.response?.data?.message || (error instanceof Error ? error.message : String(error));
            vscode.window.showErrorMessage(`Error uploading configurations: ${errorMessage}`);

            // Specific handling if the Gist ID used (from config or state) was invalid
            if (effectiveGistId && (error.response?.status === 404 || error.response?.status === 401 || error.response?.status === 403)) {
                // If the problematic ID came from global state, clear it.
                // If it came from config, we can't clear it, so just warn the user.
                const configuredGistId = vscode.workspace.getConfiguration('settingsSave').get<string | null>('gistId');
                if (configuredGistId && configuredGistId.trim() === effectiveGistId) {
                    vscode.window.showErrorMessage(`The Gist ID configured in settings ('${effectiveGistId}') seems invalid or inaccessible. Please check the ID and GitHub permissions.`);
                } else if (this.context.globalState.get<string>(GIST_ID_KEY) === effectiveGistId) {
                    await this.context.globalState.update(GIST_ID_KEY, undefined);
                    vscode.window.showWarningMessage(`Stored Gist ID ('${effectiveGistId}') was invalid or inaccessible and has been cleared from global state.`);
                } else {
                    // Should not happen based on getEffectiveGistId logic, but good to have a fallback
                    vscode.window.showWarningMessage(`The Gist ID ('${effectiveGistId}') used was invalid or inaccessible.`);
                }
            }
        }
    }

    public async downloadSettings(): Promise<void> {
        let token: string;
        let effectiveGistId: string | undefined;
        try {
            token = await this.getGitHubToken();
            effectiveGistId = this.getEffectiveGistId(); // Use the helper function

            if (!effectiveGistId) {
                vscode.window.showInformationMessage('No Gist ID found in configuration or global state. Please configure a Gist ID or upload configurations first to create one.');
                return;
            }

            const headers = {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            };

            vscode.window.showInformationMessage(`Downloading configurations from Gist: ${effectiveGistId}...`);
            // Fetch the Gist
            const response = await axios.get(`https://api.github.com/gists/${effectiveGistId}`, { headers });
            const gist = response.data;

            if (!gist.files) {
                vscode.window.showErrorMessage('Gist contains no files.');
                return;
            }

            const files = gist.files;
            let appliedSomething = false;

            // Apply User Settings
            if (files[USER_SETTINGS_FILENAME] && files[USER_SETTINGS_FILENAME].content) {
                vscode.window.showInformationMessage('Applying user settings...');
                await this.applyUserSettings(files[USER_SETTINGS_FILENAME].content);
                appliedSomething = true;
            } else {
                vscode.window.showInformationMessage(`No ${USER_SETTINGS_FILENAME} found in Gist.`);
            }

            // Apply Keybindings
            if (files[KEYBINDINGS_FILENAME] && files[KEYBINDINGS_FILENAME].content) {
                vscode.window.showInformationMessage('Applying keybindings...');
                await this.applyKeybindings(files[KEYBINDINGS_FILENAME].content);
                appliedSomething = true;
            } else {
                vscode.window.showInformationMessage(`No ${KEYBINDINGS_FILENAME} found in Gist.`);
            }

            // Apply Extensions
            if (files[EXTENSIONS_FILENAME] && files[EXTENSIONS_FILENAME].content) {
                vscode.window.showInformationMessage('Checking extensions...');
                await this.applyExtensions(files[EXTENSIONS_FILENAME].content);
                appliedSomething = true;
            } else {
                vscode.window.showInformationMessage(`No ${EXTENSIONS_FILENAME} found in Gist.`);
            }

            if (appliedSomething) {
                vscode.window.showInformationMessage('Configuration download and apply process finished. You may need to reload VS Code for all changes to take effect.');
            } else {
                vscode.window.showWarningMessage('No configuration files found in the Gist to apply.');
            }

        } catch (error: any) {
            console.error('Error downloading configurations:', error);
            const errorMessage = error.response?.data?.message || (error instanceof Error ? error.message : String(error));
            vscode.window.showErrorMessage(`Error downloading configurations: ${errorMessage}`);

            // Specific handling if the Gist ID used (from config or state) was invalid
            if (effectiveGistId && (error.response?.status === 404 || error.response?.status === 401 || error.response?.status === 403)) {
                // If the problematic ID came from global state, clear it.
                // If it came from config, we can't clear it, so just warn the user.
                const configuredGistId = vscode.workspace.getConfiguration('settingsSave').get<string | null>('gistId');
                if (configuredGistId && configuredGistId.trim() === effectiveGistId) {
                    vscode.window.showErrorMessage(`The Gist ID configured in settings ('${effectiveGistId}') seems invalid or inaccessible. Please check the ID and GitHub permissions.`);
                } else if (this.context.globalState.get<string>(GIST_ID_KEY) === effectiveGistId) {
                    await this.context.globalState.update(GIST_ID_KEY, undefined);
                    vscode.window.showWarningMessage(`Stored Gist ID ('${effectiveGistId}') was invalid or inaccessible and has been cleared from global state.`);
                } else {
                    vscode.window.showWarningMessage(`The Gist ID ('${effectiveGistId}') used was invalid or inaccessible.`);
                }
            }
        }
    }
} 