/**
 * This file is part of the vscode-deploy-reloaded distribution.
 * Copyright (c) Marcel Joachim Kloubert.
 * 
 * vscode-deploy-reloaded is free software: you can redistribute it and/or modify  
 * it under the terms of the GNU Lesser General Public License as   
 * published by the Free Software Foundation, version 3.
 *
 * vscode-deploy-reloaded is distributed in the hope that it will be useful, but 
 * WITHOUT ANY WARRANTY; without even the implied warranty of 
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU 
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

import * as deploy_clients from '../clients';
import * as deploy_files from '../files';
import * as deploy_helpers from '../helpers';
import * as deploy_log from '../log';
import * as FS from 'fs';
import * as Minimatch from 'minimatch';
import * as Moment from 'moment';
import * as Path from 'path';
import * as SFTP from 'ssh2-sftp-client';


/**
 * Options for a SFTP connection.
 */
export interface SFTPConnectionOptions {
    /**
     * Name or path to ssh-agent for ssh-agent-based user authentication.
     */
    readonly agent?: string;
    /**
     * Set to (true) to use OpenSSH agent forwarding (auth-agent@openssh.com) for the life of the connection.
     * 'agent' property must also be set to use this feature.
     */
    readonly agentForward?: boolean;
    /**
     * Show debug output or not.
     */
    readonly debug?: boolean;
    /**
     * The algorithm to use to verify the fingerprint of a host.
     */
    readonly hashAlgorithm?: string;
    /**
     * One or more hashes to verify.
     */
    readonly hashes?: string | string[];
    /**
     * The hostname
     */
    readonly host?: string;
    /**
     * Defines the modes for files, after they have been uploaded.
     */
    readonly modes?: SFTPFileModeSettings;
    /**
     * The password.
     */
    readonly password?: string;
    /**
     * The custom TCP port.
     */
    readonly port?: number;
    /**
     * Path to the private key file.
     */
    readonly privateKey?: string;
    /**
     * The passphrase for the key file, if needed.
     */
    readonly privateKeyPassphrase?: string;
    /**
     * How long (in milliseconds) to wait for the SSH handshake to complete.
     */
    readonly readyTimeout?: number;
    /**
     * Try keyboard-interactive user authentication if primary user authentication method fails.
     */
    readonly tryKeyboard?: boolean;
    /**
     * The username.
     */
    readonly user?: string;
}

/**
 * A value for a file mode.
 */
export type SFTPFileMode = number | string;

/**
 * Patterns with file modes.
 */
export type SFTPFileModePatterns = { [ pattern: string ]: SFTPFileMode };

/**
 * A possible file mode setting value.
 */
export type SFTPFileModeSettings = SFTPFileMode | SFTPFileModePatterns;


/**
 * The default value for a host address.
 */
export const DEFAULT_HOST = '127.0.0.1';


/**
 * A basic SFTP client.
 */
export class SFTPClient extends deploy_clients.AsyncFileListBase {
    private _checkedRemoteDirs: { [ path: string ]: boolean } = {};

    /**
     * Initializes a new instance of that class.
     * 
     * @param {SFTP} client The underlying client.
     */
    constructor(public readonly options: SFTPConnectionOptions) {
        super();

        this.client = new SFTP();

        if (deploy_helpers.toBooleanSafe(options.tryKeyboard)) {
            let pwd = deploy_helpers.toStringSafe(options.password);

            this.client['client'].on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
                try {
                    finish([ pwd ]);
                }
                catch (e) {
                    deploy_log.CONSOLE
                              .trace(e, 'clients.sftp.SFTPClient(keyboard-interactive)');
                }
            });
        }
    }

    /**
     * Gets the underlying client.
     */
    public readonly client: SFTP;

    /** @inheritdoc */
    public async deleteFile(path: string): Promise<boolean> {
        path = toSFTPPath(path);

        try {
            await this.client.delete(path);

            return true;
        }
        catch (e) {
            return false;
        }
    }

    /** @inheritdoc */
    public async downloadFile(path: string): Promise<Buffer> {
        const ME = this;

        path = toSFTPPath(path);

        return new Promise<Buffer>(async (resolve, reject) => {
            const COMPLETED = deploy_helpers.createCompletedAction(resolve, reject);

            try {
                const STREAM = await ME.client.get(path, null, null);

                STREAM.once('error', (err) => {
                    COMPLETED(err);
                });
        
                const DOWNLOADED_DATA = await deploy_helpers.invokeForTempFile(async (tmpFile) => {
                    return new Promise<Buffer>((res, rej) => {
                        const COMP = deploy_helpers.createCompletedAction(res, rej);
        
                        try {
                            const PIPE = STREAM.pipe(
                                FS.createWriteStream(tmpFile)
                            );
        
                            PIPE.once('error', (err) => {
                                COMP(err);
                            });
        
                            STREAM.once('end', () => {
                                deploy_helpers.readFile(tmpFile).then((data) => {
                                    COMP(null, data);
                                }).catch((err) => {
                                    COMP(err);
                                });
                            });
                        }
                        catch (e) {
                            COMP(e);
                        }
                    });
                });
        
                COMPLETED(null, DOWNLOADED_DATA);
            }
            catch (e) {
                COMPLETED(e);
            }
        });
    }

    /** @inheritdoc */
    public async listDirectory(path: string): Promise<deploy_files.FileSystemInfo[]> {
        const ME = this;

        path = toSFTPPath(path);

        const RESULT: deploy_files.FileSystemInfo[] = [];

        const LIST = await ME.client.list(path);

        for (const FI of LIST) {
            if ('d' === FI.type) {
                RESULT.push(
                    {
                        //TODO: exportPath: false,
                        name: FI.name,
                        path: deploy_helpers.normalizePath(path),
                        size: FI.size,
                        time: Moment(FI.modifyTime),
                        type: deploy_files.FileSystemType.Directory,
                    }
                );
            }
            else if ('-' === FI.type) {
                const SFTP_FILE: deploy_files.FileInfo = {
                    download: async () => {
                        const CLIENT = await openConnection(ME.options);
                        try {
                            return await CLIENT.downloadFile(
                                deploy_helpers.normalizePath(path) +
                                '/' +
                                deploy_helpers.normalizePath(FI.name)
                            );
                        }
                        finally {
                            try {
                                await CLIENT.client.end();
                            }
                            catch (e) {
                                deploy_log.CONSOLE
                                          .trace(e, 'clients.sftp.SFTPClient.listDirectory().FI.download()');
                            }
                        }
                    },
                    //TODO: exportPath: false,
                    name: FI.name,
                    path: deploy_helpers.normalizePath(path),
                    size: FI.size,
                    time: Moment(FI.modifyTime),
                    type: deploy_files.FileSystemType.File,
                };

                RESULT.push(SFTP_FILE);
            }
            else {
                RESULT.push(
                    {
                        //TODO: exportPath: false,
                        name: FI.name,
                        path: deploy_helpers.normalizePath(path),
                        size: FI.size,
                        time: Moment(FI.modifyTime),
                    }
                );
            }
        }

        return RESULT;
    }

    /** @inheritdoc */
    public get type(): string {
        return 'sftp';
    }

    /** @inheritdoc */
    public uploadFile(path: string, data: Buffer): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            const COMPLETED = deploy_helpers.createCompletedAction(resolve, reject);

            try {
                const REMOTE_DIR = toSFTPPath(
                    Path.dirname(path)
                );

                path = toSFTPPath(path);

                let fileModes: SFTPFileModePatterns | false = false;
                if (!deploy_helpers.isNullOrUndefined(this.options.modes)) {
                    let modes = this.options.modes;
                    if (!deploy_helpers.isObject<SFTPFileModePatterns>(modes)) {
                        modes = {
                            '**/*': modes
                        };
                    }

                    fileModes = modes;
                }

                // check if remote directory exists
                if (true !== this._checkedRemoteDirs[REMOTE_DIR]) {
                    try {
                        // check if exist
                        await this.client.list(REMOTE_DIR);
                    }
                    catch (e) {
                        // no, try to create
                        await this.client.mkdir(REMOTE_DIR, true);
                    }

                    // mark as checked
                    this._checkedRemoteDirs[REMOTE_DIR] = true;
                }

                let modeToSet: number | false = false;
                if (false !== fileModes) {
                    let matchedPattern: false | string = false;
                    for (const P in fileModes) {
                        let pattern = P;
                        if (!pattern.startsWith('/')) {
                            pattern = '/' + pattern;
                        }

                        const MATCH_OPTS: Minimatch.IOptions = {
                            dot: true,
                            nocase: true,                
                        };

                        if (deploy_helpers.doesMatch(path, pattern, MATCH_OPTS)) {
                            matchedPattern = P;
                            modeToSet = parseInt(deploy_helpers.toStringSafe(fileModes[P]).trim(),
                                                 8);
                            break;
                        }
                    }

                    if (false === matchedPattern) {
                        deploy_log.CONSOLE
                                  .notice(`'${path}' does NOT match with a mode pattern`, 'clients.sftp.uploadFile(3)');
                    }
                    else {
                        deploy_log.CONSOLE
                                  .notice(`'${path}' matches with mode pattern '${matchedPattern}'`, 'clients.sftp.uploadFile(3)');
                    }
                }

                await this.client.put(
                    data,
                    path,
                );

                if (false !== modeToSet) {
                    deploy_log.CONSOLE
                              .info(`Setting mode for '${path}' to ${modeToSet.toString(8)} ...`, 'clients.sftp.uploadFile(1)');

                    this.client['sftp'].chmod(path, modeToSet, (err) => {
                        if (err) {
                            deploy_log.CONSOLE
                                      .trace(err, 'clients.sftp.uploadFile(2)');
                        }

                        COMPLETED(err);
                    });
                }
                else {
                    COMPLETED(null);
                }
            }
            catch (e) {
                COMPLETED(e);
            }
        });
    }
}


/**
 * Creates a new client.
 * 
 * @param {SFTPConnectionOptions} opts The options.
 * 
 * @return {SFTPClient} The new client.
 */
export function createClient(opts: SFTPConnectionOptions): SFTPClient {
    if (!opts) {
        opts = <any>{};
    }

    return new SFTPClient(opts);
}

/**
 * Opens a connection.
 * 
 * @param {SFTPConnectionOptions} opts The options.
 * 
 * @return {Promise<SFTPClient>} The promise with new client.
 */
export async function openConnection(opts: SFTPConnectionOptions): Promise<SFTPClient> {
    const CLIENT = createClient(opts);

    let host = deploy_helpers.normalizeString(opts.host);
    if ('' === host) {
        host = '127.0.0.1';
    }

    let port = parseInt(
        deploy_helpers.toStringSafe(opts.port).trim()
    );
    if (isNaN(port)) {
        port = 22;
    }

    let agent = deploy_helpers.toStringSafe(opts.agent);
    if (deploy_helpers.isEmptyString(agent)) {
        agent = undefined;
    }

    let hashAlgo: any = deploy_helpers.normalizeString(opts.hashAlgorithm);
    if ('' === hashAlgo) {
        hashAlgo = 'md5';
    }

    // supported hashes
    let hashes = deploy_helpers.asArray(opts.hashes)
                               .map(x => deploy_helpers.normalizeString(x))
                               .filter(x => '' !== x);

    // username and password
    let user = deploy_helpers.toStringSafe(opts.user);
    if ('' === user) {
        user = undefined;
    }
    let pwd = deploy_helpers.toStringSafe(opts.password);
    if ('' === pwd) {
        pwd = undefined;
    }

    let privateKeyFile: string | false = deploy_helpers.toStringSafe(opts.privateKey);
    if (deploy_helpers.isEmptyString(privateKeyFile)) {
        privateKeyFile = false;
    }

    let privateKeyPassphrase = deploy_helpers.toStringSafe(opts.privateKeyPassphrase);
    if ('' === privateKeyPassphrase) {
        privateKeyPassphrase = undefined;
    }

    let readyTimeout = parseInt( deploy_helpers.toStringSafe(opts.readyTimeout).trim() );
    if (isNaN(readyTimeout)) {
        readyTimeout = 20000;
    }

    let privateKey: Buffer;
    if (false !== privateKeyFile) {
        privateKey = await deploy_helpers.readFile(privateKeyFile);
    }

    const DEBUG = deploy_helpers.toBooleanSafe(opts.debug);

    await CLIENT.client.connect({
        agent: agent,
        agentForward: deploy_helpers.toBooleanSafe(opts.agentForward),
        hostHash: hashAlgo,
        hostVerifier: (keyHash) => {
            if (hashes.length < 1) {
                return true;
            }

            keyHash = deploy_helpers.normalizeString(keyHash);
            return hashes.indexOf(keyHash) > -1;
        },
        host: host,
        passphrase: privateKeyPassphrase,
        password: pwd,
        port: port,
        privateKey: privateKey,
        readyTimeout: readyTimeout,
        tryKeyboard: deploy_helpers.toBooleanSafe(opts.tryKeyboard),
        username: user,

        debug: (info) => {
            if (!DEBUG) {
                return;
            }

            deploy_log.CONSOLE
                      .debug(info, `clients.sftp`);
        }
    });

    return CLIENT;
}

/**
 * Converts to a SFTP path.
 * 
 * @param {string} path The path to convert.
 * 
 * @return {string} The converted path. 
 */
export function toSFTPPath(path: string) {
    return '/' + deploy_helpers.normalizePath(path);
}
