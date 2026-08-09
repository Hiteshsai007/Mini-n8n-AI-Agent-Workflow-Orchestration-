// Clean up test data before running Slice 2 tests
const HASURA = 'http://localhost:8080/v1/graphql';
const SECRET = 'myadminsecret';

async function gql(query) {
  const r = await fetch(HASURA, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hasura-Admin-Secret': SECRET },
    body: JSON.stringify({ query }),
  });
  return r.json();
}

async function main() {
  // Delete old runs
  await gql('mutation { delete_step_runs(where: {}) { affected_rows } }');
  await gql('mutation { delete_workflow_runs(where: {}) { affected_rows } }');
  
  // Reset quota
  const orgA = 'a0000000-0000-0000-0000-000000000001';
  await gql(`mutation { update_organizations(where: {id: {_eq: "${orgA}"}}, _set: {calls_used: 0}) { affected_rows } }`);
  
  // Restore http_request config  
  const wf = 'e0000000-0000-0000-0000-00000000a001';
  const config = JSON.stringify({url: "https://httpbin.org/post", method: "POST", headers: {}, body: {}});
  await gql(`mutation { update_workflow_steps(where: {workflow_id: {_eq: "${wf}"}, type: {_eq: "http_request"}}, _set: {config: ${JSON.stringify(config)}}) { affected_rows } }`);
  
  console.log('✓ Test data cleaned');
}

main().catch(console.error);
