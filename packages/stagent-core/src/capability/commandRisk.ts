/**
 * 命令高风险分级（纯函数）。
 *
 * 与 `CodeRunnerCommandLint.detectDangerousShellCommandIssues` **互补**：那里做灾难硬阻断
 * （`rm -rf /`、`curl|sh`、fork bomb）；这里覆盖更广的"高风险"并产分级（不硬阻断），
 * 由上层据 `highRiskNeedsApproval` 决定是否走审批。
 *
 * 高风险模式：
 * - `git push`（含 `--force` / `-f`）
 * - `rm -rf <任意>`（非仅根）
 * - `sudo `
 * - `chmod 777`
 * - `mkfs`
 * - `dd if=...of=`
 * - SQL `DROP TABLE` / `TRUNCATE` / `DELETE FROM`（无 WHERE 视更高危）
 * - `npm publish`
 * - `> /dev/sd`
 */

export function classifyCommandRisk(command: string): { highRisk: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (typeof command !== 'string' || command.length === 0) {
    return { highRisk: false, reasons: [] };
  }
  const cmd = command;

  if (/\bgit\s+push\b/.test(cmd)) {
    if (/\bgit\s+push\b[^\n]*(\s--force\b|\s--force-with-lease\b|\s-f\b)/.test(cmd)) {
      reasons.push('git-push-force');
    } else {
      reasons.push('git-push');
    }
  }

  if (/\brm\s+-[a-zA-Z]*r[a-zA-Z]*f\b/.test(cmd) || /\brm\s+-[a-zA-Z]*f[a-zA-Z]*r\b/.test(cmd)) {
    reasons.push('rm-rf');
  }

  if (/(^|[\s;&|])sudo\s+/.test(cmd)) {
    reasons.push('sudo');
  }

  if (/\bchmod\s+(-[a-zA-Z]+\s+)*777\b/.test(cmd)) {
    reasons.push('chmod-777');
  }

  if (/\bmkfs\b/.test(cmd)) {
    reasons.push('mkfs');
  }

  if (/\bdd\b[^\n]*\bif=[^\s]+[^\n]*\bof=[^\s]+/.test(cmd)) {
    reasons.push('dd-overwrite');
  }

  if (/\bDROP\s+TABLE\b/i.test(cmd)) {
    reasons.push('sql-drop-table');
  }
  if (/\bTRUNCATE\b/i.test(cmd)) {
    reasons.push('sql-truncate');
  }
  if (/\bDELETE\s+FROM\b/i.test(cmd)) {
    if (/\bDELETE\s+FROM\b[^;]*\bWHERE\b/i.test(cmd)) {
      reasons.push('sql-delete');
    } else {
      reasons.push('sql-delete-no-where');
    }
  }

  if (/\bnpm\s+publish\b/.test(cmd)) {
    reasons.push('npm-publish');
  }

  if (/>\s*\/dev\/sd[a-z]/.test(cmd)) {
    reasons.push('write-block-device');
  }

  return { highRisk: reasons.length > 0, reasons };
}
