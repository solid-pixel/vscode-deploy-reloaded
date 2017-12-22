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


/**
 * Quick execution of JavaScript code.
 * 
 * @param {any} _9cecd2fa49be45138bb5c73f1fa33242_152942589 The extension context.
 * @param {any|any[]} _946ed8fa480a4882bfe021a39aafaea6_823684747 List of all workspaces.
 * @param {any|any[]} activeWorkspaces List of all active workspaces.
 */
export async function _1b87f2ee_b636_45b6_807c_0e2d25384b02_1409614337(
    _9cecd2fa49be45138bb5c73f1fa33242_152942589: any,
    _946ed8fa480a4882bfe021a39aafaea6_823684747: any | any[],
    _1cec53bb4eda4fff8c3bb572dd0ce347_1551074281: any | any[],
) {
    // vscode
    const $vs = require('vscode');

    // i18
    const $i18 = require('../i18');

    // helpers
    const $h = require('../helpers');
    // logger
    const $l = require('../log').CONSOLE;

    try {
        // all workspaces
        const $w: any[] = $h.asArray(_946ed8fa480a4882bfe021a39aafaea6_823684747);
        // all active workspaces
        const $aw: any[] = $h.asArray(_1cec53bb4eda4fff8c3bb572dd0ce347_1551074281);
        
        // require
        const $r = (id: any) => {
            return $h.requireFromExtension(id);
        };
        
        const $unwrap = async (val: any, maxDepth?: number, currentDepth?: number) => {
            if (isNaN(maxDepth)) {
                maxDepth = 64;
            }
            if (isNaN(currentDepth)) {
                currentDepth = 0;
            }

            if (currentDepth < maxDepth) {
                if (val) {
                    if ('function' === typeof val) {
                        val = $unwrap(
                            Promise.resolve(
                                val()
                            ),
                            maxDepth, currentDepth + 1
                        );
                    }
                }
            }

            return val;
        };

        // toStringSafe()
        const $s = async (val: any) => {
            return $h.toStringSafe(
                await $unwrap(val)
            );
        };

        // eval()
        const $e = async (code: any) => {
            return await $unwrap(
                eval(await $s(code))
            );
        };

        // code to execute
        const _def303d6_7db1_4511_8365_e93ed7979b92_1379012881 = await $vs.window.showInputBox(
            {
                placeHolder: $i18.t('tools.quickExecution.inputCode'),
                value: await $s(_9cecd2fa49be45138bb5c73f1fa33242_152942589.workspaceState.get('vscdrLastQuickExecutionCode')),
            }
        );
        if ($h.isEmptyString(_def303d6_7db1_4511_8365_e93ed7979b92_1379012881)) {
            return;
        }

        // save last executed code
        _9cecd2fa49be45138bb5c73f1fa33242_152942589.workspaceState.update('vscdrLastQuickExecutionCode',
                                                                          _def303d6_7db1_4511_8365_e93ed7979b92_1379012881);

        const RESULT = await Promise.resolve(
            $e(_def303d6_7db1_4511_8365_e93ed7979b92_1379012881)
        );

        if ('undefined' !== typeof RESULT) {
            $vs.window.showInformationMessage(
                $h.toStringSafe( RESULT )
            ).then(() => {}, (err) => {
                $l.trace(err, 'quickexecution._1b87f2ee_b636_45b6_807c_0e2d25384b02_1409614337(1)');
            });
        }
    }
    catch (e) {
        $vs.window.showErrorMessage(
            $i18.t('tools.quickExecution.errors.failed', e)  
        );
    }
}