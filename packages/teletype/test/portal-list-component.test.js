const assert = require('assert')
const etch = require('etch')
const condition = require('./helpers/condition')
const {Disposable} = require('atom')
const FakeClipboard = require('./helpers/fake-clipboard')
const {TeletypeClient} = require('@atom/teletype-client')
const {startTestServer} = require('@atom/teletype-server')
const PortalBindingManager = require('../lib/portal-binding-manager')
const PortalListComponent = require('../lib/portal-list-component')

suite('PortalListComponent', function () {
  if (process.env.CI) this.timeout(process.env.TEST_TIMEOUT_IN_MS)

  let testServer, portalBindingManagers

  suiteSetup(async function () {
    testServer = await startTestServer({databaseURL: 'postgres://localhost:5432/teletype-test'})
  })

  suiteTeardown(() => {
    return testServer.stop()
  })

  setup(() => {
    portalBindingManagers = []
    return testServer.reset()
  })

  teardown(async () => {
    for (const portalBindingManager of portalBindingManagers) {
      await portalBindingManager.dispose()
    }
  })

  test('initialization', async () => {
    const portalBindingManager = await buildPortalBindingManager()
    const component = new PortalListComponent({
      portalBindingManager,
      commandRegistry: new FakeCommandRegistry(),
      localUserIdentity: {login: 'some-user'}
    })
    assert(component.refs.initializationSpinner)
    assert(!component.refs.hostPortalBindingComponent)

    await component.initializationPromise
    assert(!component.refs.initializationSpinner)
    assert(component.refs.hostPortalBindingComponent)
  })

  test('sharing portals', async () => {
    const {component, element, portalBindingManager} = await buildComponent()

    const {hostPortalBindingComponent} = component.refs
    assert(!hostPortalBindingComponent.refs.toggleShareCheckbox.checked)
    assert(!hostPortalBindingComponent.refs.creatingPortalSpinner)

    // Toggle sharing on.
    hostPortalBindingComponent.toggleShare()
    await condition(() => (
      hostPortalBindingComponent.refs.toggleShareCheckbox.checked &&
      hostPortalBindingComponent.refs.creatingPortalSpinner
    ))
    await condition(() => (
      hostPortalBindingComponent.refs.toggleShareCheckbox.checked &&
      !hostPortalBindingComponent.refs.creatingPortalSpinner
    ))

    // Simulate multiple guests joining.
    const {portal} = await portalBindingManager.getHostPortalBinding()

    const guestPortalBindingManager1 = await buildPortalBindingManager()
    await guestPortalBindingManager1.createGuestPortalBinding(portal.id)

    const guestPortalBindingManager2 = await buildPortalBindingManager()
    await guestPortalBindingManager2.createGuestPortalBinding(portal.id)

    await condition(() => queryParticipantElements(element).length === 3)
    assert(queryParticipantElement(element, 1))
    assert(queryParticipantElement(element, 2))
    assert(queryParticipantElement(element, 3))

    // Toggle sharing off.
    hostPortalBindingComponent.toggleShare()

    await condition(() => queryParticipantElements(element).length === 1)
    assert(!hostPortalBindingComponent.refs.toggleShareCheckbox.checked)
    assert(!hostPortalBindingComponent.refs.creatingPortalSpinner)
  })

  test('joining portals', async () => {
    const {component, element, portalBindingManager} = await buildComponent()
    const {joinPortalComponent, guestPortalBindingsContainer} = component.refs

    assert(joinPortalComponent.refs.joinPortalLabel)
    assert(!joinPortalComponent.refs.portalIdEditor)
    assert(!joinPortalComponent.refs.joiningSpinner)

    await joinPortalComponent.showPrompt()

    assert(!joinPortalComponent.refs.joinPortalLabel)
    assert(joinPortalComponent.refs.portalIdEditor)
    assert(!joinPortalComponent.refs.joiningSpinner)

    // Insert an invalid portal id.
    joinPortalComponent.refs.portalIdEditor.setText('invalid-portal-id')
    joinPortalComponent.joinPortal()

    await condition(() => (
      !joinPortalComponent.refs.joinPortalLabel &&
      joinPortalComponent.refs.joiningSpinner &&
      !joinPortalComponent.refs.portalIdEditor
    ))
    await condition(() => (
      !joinPortalComponent.refs.joinPortalLabel &&
      !joinPortalComponent.refs.joiningSpinner &&
      joinPortalComponent.refs.portalIdEditor
    ))

    // Insert a valid portal id.
    const hostPortalBindingManager = await buildPortalBindingManager()
    const {portal: hostPortal} = await hostPortalBindingManager.createHostPortalBinding()

    joinPortalComponent.refs.portalIdEditor.setText(hostPortal.id)
    joinPortalComponent.joinPortal()

    await condition(() => (
      !joinPortalComponent.refs.joinPortalLabel &&
      joinPortalComponent.refs.joiningSpinner &&
      !joinPortalComponent.refs.portalIdEditor
    ))
    await condition(() => (
      joinPortalComponent.refs.joinPortalLabel &&
      !joinPortalComponent.refs.joiningSpinner &&
      !joinPortalComponent.refs.portalIdEditor
    ))
    await condition(() => queryParticipantElements(guestPortalBindingsContainer).length === 2)
    assert(queryParticipantElement(guestPortalBindingsContainer, 1))
    assert(queryParticipantElement(guestPortalBindingsContainer, 2))

    // Simulate another guest joining the portal.
    const newGuestPortalBindingManager = await buildPortalBindingManager()
    await newGuestPortalBindingManager.createGuestPortalBinding(hostPortal.id)

    await condition(() => queryParticipantElements(guestPortalBindingsContainer).length === 3)
    assert(queryParticipantElement(guestPortalBindingsContainer, 1))
    assert(queryParticipantElement(guestPortalBindingsContainer, 2))
    assert(queryParticipantElement(guestPortalBindingsContainer, 3))
  })

  test('prefilling portal ID from clipboard', async () => {
    const {component} = await buildComponent()
    const {clipboard} = component.props
    const {joinPortalComponent} = component.refs

    clipboard.write('bc282ad8-7643-42cb-80ca-c243771a618f')
    await joinPortalComponent.showPrompt()

    assert.equal(joinPortalComponent.refs.portalIdEditor.getText(), 'bc282ad8-7643-42cb-80ca-c243771a618f')

    await joinPortalComponent.hidePrompt()
    clipboard.write('not a portal id')
    await joinPortalComponent.showPrompt()

    assert.equal(joinPortalComponent.refs.portalIdEditor.getText(), '')
  })

  function queryParticipantElement (element, siteId) {
    const participants = element.querySelectorAll('.PortalParticipants-site-' + siteId)
    assert.equal(participants.length, 1)
    return participants[0]
  }

  function queryParticipantElements (element) {
    return element.querySelectorAll('.PortalParticipants-participant')
  }

  async function buildComponent () {
    const portalBindingManager = await buildPortalBindingManager()
    const component = new PortalListComponent({
      portalBindingManager,
      clipboard: new FakeClipboard(),
      commandRegistry: new FakeCommandRegistry(),
      localUserIdentity: portalBindingManager.client.getLocalUserIdentity()
    })
    await component.initializationPromise

    return {component, element: component.element, portalBindingManager}
  }

  async function buildPortalBindingManager () {
    const client = new TeletypeClient({
      baseURL: testServer.address,
      pubSubGateway: testServer.pubSubGateway
    })
    await client.initialize()
    await client.signIn('some-token')

    const portalBindingManager = new PortalBindingManager({
      client,
      workspace: new FakeWorkspace(),
      notificationManager: new FakeNotificationManager()
    })
    portalBindingManagers.push(portalBindingManager)
    return portalBindingManager
  }
})

class FakeWorkspace {
  async open () {}

  getElement () {
    return document.createElement('div')
  }

  observeActiveTextEditor () {
    return new Disposable(() => {})
  }
}

class FakeNotificationManager {
  addInfo () {}

  addSuccess () {}

  addError () {}
}

class FakeCommandRegistry {
  add () {}
}
