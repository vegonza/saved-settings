import * as vscode from 'vscode';
import axios from 'axios';

const GIST_ID_KEY = 'settingsSave.gistId';
const GIST_FILENAME = 'vscode_settings.json';

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

    private getVSCodeSettings(): string {
        // Placeholder for getting actual VS Code settings
        // In a real scenario, you would read settings using vscode.workspace.getConfiguration()
        // and potentially filter/serialize them as needed.
        return JSON.stringify({ setting1: 'value1', setting2: 'value2' }, null, 2);
    }

    private applyVSCodeSettings(settingsContent: string): void {
        // Placeholder for applying settings
        // In a real scenario, you would parse settingsContent and update
        // VS Code settings using vscode.workspace.getConfiguration().update()
        console.log('Applying settings:', settingsContent);
        vscode.window.showInformationMessage('Settings would be applied here (check console log).');
    }

    public async uploadSettings(): Promise<void> {
        try {
            const token = await this.getGitHubToken();
            const settingsContent = this.getVSCodeSettings();
            const gistId = this.context.globalState.get<string>(GIST_ID_KEY);
            const headers = {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            };

            const gistPayload = {
                description: 'VS Code Settings Backup',
                files: {
                    [GIST_FILENAME]: {
                        content: settingsContent
                    }
                }
            };

            if (gistId) {
                // Update existing Gist
                await axios.patch(`https://api.github.com/gists/${gistId}`, gistPayload, { headers });
                vscode.window.showInformationMessage('Settings successfully uploaded to existing Gist!');
            } else {
                // Create new Gist
                const response = await axios.post('https://api.github.com/gists', gistPayload, { headers });
                const newGistId = response.data.id;
                await this.context.globalState.update(GIST_ID_KEY, newGistId);
                vscode.window.showInformationMessage(`Settings successfully uploaded to new Gist: ${newGistId}`);
            }
        } catch (error: any) {
            console.error('Error uploading settings:', error);
            const errorMessage = error.response?.data?.message || (error instanceof Error ? error.message : String(error));
            vscode.window.showErrorMessage(`Error uploading settings: ${errorMessage}`);
            // Consider removing the Gist ID if the upload failed due to Gist not found or auth issues
            if (error.response?.status === 404 || error.response?.status === 401 || error.response?.status === 403) {
                await this.context.globalState.update(GIST_ID_KEY, undefined);
                vscode.window.showWarningMessage('Stored Gist ID might be invalid and has been cleared.');
            }
        }
    }

    public async downloadSettings(): Promise<void> {
        try {
            const token = await this.getGitHubToken();
            const gistId = this.context.globalState.get<string>(GIST_ID_KEY);

            if (!gistId) {
                vscode.window.showInformationMessage('No Gist ID found. Please upload settings first to create a Gist.');
                return;
            }

            const headers = {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            };

            // Fetch the Gist
            const response = await axios.get(`https://api.github.com/gists/${gistId}`, { headers });
            const gist = response.data;

            // Find the settings file in the Gist
            if (gist.files && gist.files[GIST_FILENAME]) {
                const settingsContent = gist.files[GIST_FILENAME].content;
                // Apply the settings (implement this part based on your needs)
                this.applyVSCodeSettings(settingsContent);
                vscode.window.showInformationMessage('Settings successfully downloaded and applied from Gist!');
            } else {
                vscode.window.showErrorMessage(`Could not find ${GIST_FILENAME} in the Gist.`);
            }
        } catch (error: any) {
            console.error('Error downloading settings:', error);
            const errorMessage = error.response?.data?.message || (error instanceof Error ? error.message : String(error));
            vscode.window.showErrorMessage(`Error downloading settings: ${errorMessage}`);
            // Consider removing the Gist ID if the download failed due to Gist not found or auth issues
            if (error.response?.status === 404 || error.response?.status === 401 || error.response?.status === 403) {
                await this.context.globalState.update(GIST_ID_KEY, undefined);
                vscode.window.showWarningMessage('Stored Gist ID might be invalid and has been cleared.');
            }
        }
    }
} 