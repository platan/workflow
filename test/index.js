const app = require('..')
const nock = require('nock')
const {Probot} = require('probot')

const issueCreatedPayload = require('./fixtures/webhook/issue.created.bkeepers-inc')
const issueLabeledPayload = require('./fixtures/webhook/issues.labeled')
const probotContent = require('./fixtures/content/probot')

describe('app', () => {
  let robot
  let github
  let context

  const configure = async (content, path = '.github/probot.js') => {
    const probotContentCopy = JSON.parse(JSON.stringify(probotContent))
    probotContentCopy.content = Buffer.from(content).toString('base64')
    nock('https://api.github.com')
      .get('/repos/bkeepers-inc/test/contents/' + encodeURIComponent(path))
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
    it.only('posts a comment', async () => {
      // TODO do we need to mock this?
      // nock("https://api.github.com")
      //   .post("/app/installations/1/access_tokens")
      //   .reply(200, { token: "test" });

      await configure(`
        on("issues")
          .comment("Hello World!");
        `)

      const issueCreatedBody = { body: 'Hello World!' }
      nock('https://api.github.com')
        .post('/repos/bkeepers-inc/test/issues/1/comments', (body) => {
          expect(body).toMatchObject(issueCreatedBody)
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
    it.only('calls action when condition matches', async () => {
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

    it.only('does not call action when conditions do not match', async () => {
      await configure(`
        on("issues.labeled")
          .filter((e) => e.payload.label.name == "foobar")
          .close();
        `)

      await robot.receive({ name: 'issues', payload: issueLabeledPayload })
    })
  })

  describe('include', () => {
    it.only('executes included rules', async () => {
      await configure('include(".github/triage.js");')
      await configure('on("issues").comment("Hello!");', '.github/triage.js')

      const issueCreatedBody = { body: 'Hello!' }
      nock('https://api.github.com')
        .post('/repos/bkeepers-inc/test/issues/1/comments', (body) => {
          expect(body).toMatchObject(issueCreatedBody)
          return true
        })
        .reply(200)

      await robot.receive({ name: 'issues', payload: issueCreatedPayload })
    })

    it('includes files relative to included repository', async () => {
      await configure(params => {
        if (params.path === 'script-a.js') {
          return 'include("script-b.js")'
        }
        if (params.path === 'script-b.js') {
          return ''
        }
        return `
          include("other/repo:script-a.js");
          include("another/repo:script-a.js");
          include("script-b.js");
        `
      })
      expect(github.repos.getContents).toHaveBeenCalledTimes(1 + 3 + 2)
      expect(github.repos.getContents).toHaveBeenCalledWith({
        owner: 'other',
        repo: 'repo',
        path: 'script-b.js'
      })
      expect(github.repos.getContents).toHaveBeenCalledWith({
        owner: 'another',
        repo: 'repo',
        path: 'script-b.js'
      })
      expect(github.repos.getContents).toHaveBeenCalledWith({
        owner: 'bkeepers-inc',
        repo: 'test',
        path: 'script-b.js'
      })
    })
  })

  describe('contents', () => {
    it('gets content from repo', async () => {
      await configure(params => {
        if (params.path === '.github/ISSUE_REPLY_TEMPLATE') {
          return 'file contents'
        }
        return 'on("issues").comment(contents(".github/ISSUE_REPLY_TEMPLATE"));'
      })
      expect(github.issues.createComment).toHaveBeenCalledWith({
        owner: 'bkeepers-inc',
        repo: 'test',
        number: context.payload.issue.number,
        body: 'file contents'
      })
    })

    it('gets contents relative to included repository', async () => {
      await configure(params => {
        if (params.path === 'script-a.js') {
          return 'on("issues").comment(contents("content.md"));'
        }
        if (params.path === 'content.md') {
          return ''
        }
        return 'include("other/repo:script-a.js");'
      })
      expect(github.repos.getContents).toHaveBeenCalledWith({
        owner: 'other',
        repo: 'repo',
        path: 'content.md'
      })
    })

    it('gets multiple contents without mismatching source parameters', async () => {
      await configure(params => {
        if (params.path === 'content.md' || params.path === 'label.md') {
          return ''
        }
        return `
          on("issues")
            .comment(contents("other/repo:content.md"))
            .comment(contents("label.md"));
        `
      })
      expect(github.repos.getContents).toHaveBeenCalledWith({
        owner: 'other',
        repo: 'repo',
        path: 'content.md'
      })
      expect(github.repos.getContents).toHaveBeenCalledWith({
        owner: 'bkeepers-inc',
        repo: 'test',
        path: 'label.md'
      })
    })
  })
})
