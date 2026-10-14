// scratch/test-homepage-http.mjs
// Comprehensive automated HTTP verification of homepage, feature links, and auth redirects against localhost:3000

async function runTests() {
  const baseUrl = 'http://localhost:3000';
  console.log('Testing AI Research Hub HTTP Endpoints on', baseUrl);

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} - ${details}`);
      failed++;
    }
  }

  // 1. Homepage load and content verification
  try {
    const res = await fetch(`${baseUrl}/`);
    assert(res.status === 200, 'Homepage returns 200 OK');
    const html = await res.text();

    assert(html.includes('Discover. Analyze. Write.'), 'Hero headline present');
    assert(
      html.includes('An AI-powered research workspace for discovering scholarly evidence, organizing sources, analyzing papers and writing academic documents.'),
      'Hero supporting description present'
    );
    assert(html.includes('Get Started'), 'Hero primary CTA present');
    assert(html.includes('Explore Features'), 'Hero secondary CTA present');
    assert(html.includes('Scholarly Search'), 'Feature: Scholarly Search present');
    assert(html.includes('My Library &amp; Collections') || html.includes('My Library & Collections'), 'Feature: My Library present');
    assert(html.includes('Chat with PDF'), 'Feature: Chat with PDF present');
    assert(html.includes('Multi-Paper Research Chat'), 'Feature: Multi-Paper Chat present');
    assert(html.includes('AI Research Editor'), 'Feature: AI Research Editor present');
    assert(html.includes('DOI Import &amp; Full-Text Discovery') || html.includes('DOI Import & Full-Text Discovery'), 'Feature: DOI Import present');
    assert(html.includes('Discover Research'), 'How it works: Step 1 present');
    assert(html.includes('Save and Organize'), 'How it works: Step 2 present');
    assert(html.includes('Analyze Evidence'), 'How it works: Step 3 present');
    assert(html.includes('Write and Cite'), 'How it works: Step 4 present');
    assert(html.includes('Featured Research'), 'Featured Research section present');
    assert(!html.includes('Zero-Hallucination'), 'Zero-Hallucination claim replaced');
    assert(html.includes('Evidence-Grounded Answers'), 'Evidence-Grounded Answers claim present');
    assert(html.includes('Sign in to Library'), 'Unauthenticated Library card shows Sign in to Library');
    assert(html.includes('Sign in to Edit'), 'Unauthenticated Editor card shows Sign in to Edit');
  } catch (err) {
    assert(false, 'Homepage fetch threw an exception', err.message);
  }

  // 2. Public endpoints (no authentication required)
  try {
    const discRes = await fetch(`${baseUrl}/discover`, { redirect: 'manual' });
    assert(discRes.status === 200, 'Scholarly Search (/discover) is publicly accessible (200 OK)');

    const papersRes = await fetch(`${baseUrl}/papers`, { redirect: 'manual' });
    assert(papersRes.status === 200, 'Paper Catalog (/papers) is publicly accessible (200 OK)');
  } catch (err) {
    assert(false, 'Public endpoints check failed', err.message);
  }

  // 3. Protected endpoints redirect unauthenticated users to /login with callbackUrl
  try {
    const libRes = await fetch(`${baseUrl}/library`, { redirect: 'manual' });
    const libLocation = libRes.headers.get('location') || '';
    assert(
      libRes.status === 307 || libRes.status === 308 || libRes.status === 302,
      'Protected /library responds with redirect status',
      `Got status: ${libRes.status}`
    );
    assert(
      libLocation.includes('/login') && (libLocation.includes('callbackUrl=%2Flibrary') || libLocation.includes('callbackUrl=/library')),
      '/library redirects to /login?callbackUrl=/library',
      `Got location: ${libLocation}`
    );

    const editRes = await fetch(`${baseUrl}/editor`, { redirect: 'manual' });
    const editLocation = editRes.headers.get('location') || '';
    assert(
      editLocation.includes('/login') && (editLocation.includes('callbackUrl=%2Feditor') || editLocation.includes('callbackUrl=/editor')),
      '/editor redirects to /login?callbackUrl=/editor',
      `Got location: ${editLocation}`
    );

    const convRes = await fetch(`${baseUrl}/conversations`, { redirect: 'manual' });
    const convLocation = convRes.headers.get('location') || '';
    assert(
      convLocation.includes('/login') && (convLocation.includes('callbackUrl=%2Fconversations') || convLocation.includes('callbackUrl=/conversations')),
      '/conversations redirects to /login?callbackUrl=/conversations',
      `Got location: ${convLocation}`
    );

    const researchRes = await fetch(`${baseUrl}/research`, { redirect: 'manual' });
    const researchLocation = researchRes.headers.get('location') || '';
    assert(
      researchLocation.includes('/login') && (researchLocation.includes('callbackUrl=%2Fresearch') || researchLocation.includes('callbackUrl=/research')),
      '/research redirects to /login?callbackUrl=/research',
      `Got location: ${researchLocation}`
    );

    const agentRes = await fetch(`${baseUrl}/agent`, { redirect: 'manual' });
    const agentLocation = agentRes.headers.get('location') || '';
    assert(
      agentLocation.includes('/login') && (agentLocation.includes('callbackUrl=%2Fagent') || agentLocation.includes('callbackUrl=/agent')),
      '/agent redirects to /login?callbackUrl=/agent',
      `Got location: ${agentLocation}`
    );
  } catch (err) {
    assert(false, 'Protected endpoints check failed', err.message);
  }

  // 4. Login page preserves safe callback and passes it to Register page
  try {
    const loginRes = await fetch(`${baseUrl}/login?callbackUrl=/library`);
    assert(loginRes.status === 200, 'Login page loads with callbackUrl (200 OK)');
    const loginHtml = await loginRes.text();
    assert(
      loginHtml.includes('href="/register?callbackUrl=%2Flibrary"') || loginHtml.includes('href="/register?callbackUrl=/library"'),
      'Login page includes Register link preserving callbackUrl to /library'
    );
  } catch (err) {
    assert(false, 'Login page check failed', err.message);
  }

  // 5. Register page loads with callbackUrl and shows open registration (no institutional restriction)
  try {
    const regRes = await fetch(`${baseUrl}/register?callbackUrl=/library`);
    assert(regRes.status === 200, 'Register page loads with callbackUrl (200 OK)');
    const regHtml = await regRes.text();
    assert(
      regHtml.includes('Personal or university email addresses welcome') || regHtml.includes('Personal and university emails are welcome'),
      'Registration page confirms open email policy (personal & university welcome)'
    );
    assert(
      !regHtml.includes('Must use a university email') && !regHtml.includes('.edu only'),
      'Registration page has no institutional domain restriction'
    );
  } catch (err) {
    assert(false, 'Register page check failed', err.message);
  }

  // 6. Safe redirect sanitizer test (rejection of open-redirect attacks)
  try {
    const evilRes = await fetch(`${baseUrl}/login?callbackUrl=https://evil.com/phishing`);
    const evilHtml = await evilRes.text();
    assert(
      !evilHtml.includes('href="/register?callbackUrl=https://evil.com/phishing"'),
      'Login page does NOT pass external open-redirect URL to register'
    );
    assert(
      evilHtml.includes('href="/register?callbackUrl=%2Flibrary"') || evilHtml.includes('href="/register"'),
      'Login page safely falls back to default route on malicious callbackUrl'
    );
  } catch (err) {
    assert(false, 'Safe redirect open-redirect check failed', err.message);
  }

  console.log(`\n========================================`);
  console.log(`HTTP TESTS SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
