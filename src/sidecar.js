// Sidecar files hold the full text that was truncated out of the reports.
// When opened standalone (e.g. clicking a link in flow_report.md), a raw dump
// gives no clue which turn it belongs to or how to get back. sidecarHeader()
// prepends a small provenance banner + a back-anchor into the report so the
// file is self-locating.

// sidecarId looks like `<eventId>_<kind>.txt`, e.g. `3_req_request.txt`,
// `3_0_out_output.txt`, or `completion_completion.txt`.
export function parseSidecarId(sidecarId) {
  const base = String(sidecarId).replace(/\.txt$/, '');
  const turnMatch = base.match(/^(\d+)_/);
  const turn = turnMatch ? Number(turnMatch[1]) : null;
  const kindMatch = base.match(/_([a-z]+)$/i);
  const kind = kindMatch ? kindMatch[1] : base;
  return { turn, kind };
}

const RULE = '━'.repeat(56);

// Build the provenance banner. `taskId` is used to name the report file so the
// back-link resolves next to the namespaced outputs; the bare `flow_report.md`
// legacy copy shares the same `#turn-N` anchors.
export function sidecarHeader(sidecarId, taskId) {
  const { turn, kind } = parseSidecarId(sidecarId);
  const anchor = turn === null ? '#completion' : `#turn-${turn}`;
  const where = turn === null ? 'Completion' : `Turn ${turn}`;
  const L = [
    RULE,
    ` Task ${taskId}  ·  ${where}  ·  ${kind}`,
    ` ↩ back to report: ${taskId}_flow_report.md${anchor}`,
    `   (legacy copy: flow_report.md${anchor})`,
    RULE,
    ''
  ];
  return L.join('\n');
}

// Prepend the banner to the full text written to a sidecar file.
export function withSidecarHeader(sidecarId, taskId, text) {
  return sidecarHeader(sidecarId, taskId) + '\n' + text;
}
