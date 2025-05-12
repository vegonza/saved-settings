import * as vscode from 'vscode';
import { GistService } from './gistService';

export function activate(context: vscode.ExtensionContext) {
    console.log('Settings Save extension is now active');

    // Initialize services, passing the context
    const gistService = GistService.getInstance(context);

    // Register the upload settings command
    let uploadCommand = vscode.commands.registerCommand('settings-save.uploadSettings', async () => {
        try {
            await gistService.uploadSettings();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to run upload command: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // Register the download settings command
    let downloadCommand = vscode.commands.registerCommand('settings-save.downloadSettings', async () => {
        try {
            await gistService.downloadSettings();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to run download command: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // Add commands to the extension context
    context.subscriptions.push(uploadCommand, downloadCommand);
}

export function deactivate() { } 