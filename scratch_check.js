import { load } from './src/loader.js';
import { analyze } from './src/analyze.js';

try {
  const run = load('cline-log/1782757522666');
  const { conformance } = analyze(run, { thresholdTokens: 200, sink: () => {} });
  console.log('--- CONFORMANCE RESULTS ---');
  console.log('Total Initial Plan Steps:', conformance.total);
  console.log('Covered Steps:', conformance.covered);
  console.log('Missing Steps:', conformance.missing);
  console.log('Unexpected Steps:', conformance.unexpected);
  console.log('Score:', conformance.score);
  console.log('\n--- PLAN EVOLUTION ---');
  console.log('Kept:', conformance.planEvolution.kept);
  console.log('Dropped:', conformance.planEvolution.dropped);
  console.log('Added:', conformance.planEvolution.added);
  console.log('\n--- ATTRIBUTION ---');
  console.log('Total Actions:', conformance.attribution.totalActions);
  console.log('Attributed Actions:', conformance.attribution.attributed);
  console.log('Orphan Actions (Off-plan):', conformance.attribution.orphanCount);
  console.log('Orphans list:', conformance.attribution.orphans.map(o => `${o.kind}: ${o.text}`));
} catch (err) {
  console.error(err);
}
