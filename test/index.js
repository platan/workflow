const app = require('..')
const nock = require('nock')
const { Probot } = require('probot')

const issueCreatedPayload = require('./fixtures/webhook/issue.created.bkeepers-inc')
const issueLabeledPayload = require('./fixtures/webhook/issues.labeled')
const probotContent = require('./fixtures/content/probot')

describe('app', () => {
  let robot

  const configure = async (
    content,
    path = '.github/probot.js',
    repo = 'bkeepers-inc/test'
  ) => {
    const probotContentCopy = JSON.parse(JSON.stringify(probotContent))
    probotContentCopy.content = Buffer.from(content).toString('base64')
    nock('https://api.github.com')
      .get(`/repos/${repo}/contents/${encodeURIComponent(path)}`)
      .reply(200, probotContentCopy)
  }

  beforeEach(() => {
    nock.disableNetConnect()
    robot = new Probot({
      id: 1,
      githubToken: 'test',
      throttleOptions: { enabled: false }
    })
    robot.load(app)
  })

  afterEach(() => {
    nock.cleanAll()
    nock.enableNetConnect()
  })

  describe('reply to new issue with a comment', () => {
    it('posts a comment', async () => {
      // TODO do we need to mock this?
      // nock("https://api.github.com")
      //   .post("/app/installations/1/access_tokens")
      //   .reply(200, { token: "test" });

      await configure(`
        on("issues")
          .comment("Hello World!");
        `)

      const commentBody = { body: 'Hello World!' }
      nock('https://api.github.com')
        .post('/repos/bkeepers-inc/test/issues/1/comments', (body) => {
          expect(body).toMatchObject(commentBody)
          return true
        })
        .reply(200)

      await robot.receive({ name: 'issues', payload: issueCreatedPayload })
    })
  })

  describe('on an event with a different action', () => {
    it('does not perform behavior', async () => {
      await configure(`
        on("issues.labeled")
          .comment("Hello World!");
        `)

      // TODO do we need to check that comment was not posted
    })
  })

  describe('filter', () => {
    it('calls action when condition matches', async () => {
      await configure(`
        on("issues.labeled")
          .filter((e) => e.payload.label.name == "bug")
          .close();
        `)

      const issueCreatedBody = { state: 'closed' }
      nock('https://api.github.com')
        .patch('/repos/bkeepers-inc/test/issues/35', (body) => {
          expect(body).toMatchObject(issueCreatedBody)
          return true
        })
        .reply(200)

      await robot.receive({ name: 'issues', payload: issueLabeledPayload })
    })

    it('does not call action when conditions do not match', async () => {
      await configure(`
        on("issues.labeled")
          .filter((e) => e.payload.label.name == "foobar")
          .close();
        `)

      await robot.receive({ name: 'issues', payload: issueLabeledPayload })
    })
  })

  describe('include', () => {
    it('executes included rules', async () => {
      await configure('include(".github/triage.js");')
      await configure('on("issues").comment("Hello!");', '.github/triage.js')

      const commentBody = { body: 'Hello!' }
      nock('https://api.github.com')
        .post('/repos/bkeepers-inc/test/issues/1/comments', (body) => {
          expect(body).toMatchObject(commentBody)
          return true
        })
        .reply(200)

      await robot.receive({ name: 'issues', payload: issueCreatedPayload })
    })

    it('includes files relative to included repository', async () => {
      await configure(`
      include("other/repo:script-a.js");
      include("another/repo:script-a.js");
      include("script-b.js");
      `)
      await configure('include("script-b.js")', 'script-a.js', 'other/repo')
      await configure('include("script-b.js")', 'script-a.js', 'another/repo')
      await configure('', 'script-b.js', 'other/repo')
      await configure('', 'script-b.js', 'another/repo')
      await configure('', 'script-b.js')

      await robot.receive({ name: 'issues', payload: issueCreatedPayload })
    })
  })

  describe('contents', () => {
    it('gets content from repo', async () => {
      await configure(
        'on("issues").comment(contents(".github/ISSUE_REPLY_TEMPLATE"));'
      )
      await configure('file contents', '.github/ISSUE_REPLY_TEMPLATE')

      const commentBody = { body: 'file contents' }
      nock('https://api.github.com')
        .post('/repos/bkeepers-inc/test/issues/1/comments', (body) => {
          expect(body).toMatchObject(commentBody)
          return true
        })
        .reply(200)

      await robot.receive({ name: 'issues', payload: issueCreatedPayload })
    })

    it('gets contents relative to included repository', async () => {
      await configure('include("other/repo:script-a.js");')
      await configure(
        'on("issues").comment(contents("content.md"));',
        'script-a.js',
        'other/repo'
      )
      await configure('file contents', 'content.md', 'other/repo')

      const commentBody = { body: 'file contents' }
      nock('https://api.github.com')
        .post('/repos/bkeepers-inc/test/issues/1/comments', (body) => {
          expect(body).toMatchObject(commentBody)
          return true
        })
        .reply(200)

      await robot.receive({ name: 'issues', payload: issueCreatedPayload })
    })

    it('gets multiple contents without mismatching source parameters', async () => {
      await configure(`
        on("issues")
          .comment(contents("other/repo:content.md"))
          .comment(contents("label.md"));
      `)
      await configure('content.md - file contents', 'content.md', 'other/repo')
      await configure('label.md - file contents', 'label.md')

      nock('https://api.github.com')
        .post('/repos/bkeepers-inc/test/issues/1/comments', (body) => {
          expect(body).toMatchObject({ body: 'content.md - file contents' })
          return true
        })
        .reply(200)
      nock('https://api.github.com')
        .post('/repos/bkeepers-inc/test/issues/1/comments', (body) => {
          expect(body).toMatchObject({ body: 'label.md - file contents' })
          return true
        })
        .reply(200)

      await robot.receive({ name: 'issues', payload: issueCreatedPayload })
    })
  })
})
