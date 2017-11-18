const etch = require('etch')
const $ = etch.dom
const PortalListComponent = require('./portal-list-component')
const SignInComponent = require('./sign-in-component')
const PackageOutdatedComponent = require('./package-outdated-component')

module.exports =
class PopoverComponent {
  constructor (props) {
    this.props = props
    if (this.props.authenticationProvider) {
      this.props.authenticationProvider.onDidChange(() => { this.update() })
    }
    etch.initialize(this)
  }

  update () {
    return etch.update(this)
  }

  render () {
    const {
      isClientOutdated, authenticationProvider, portalBindingManager,
      commandRegistry, credentialCache, clipboard, workspace
    } = this.props

    let activeComponent
    if (isClientOutdated) {
      activeComponent = $(PackageOutdatedComponent, {
        ref: 'packageOutdatedComponent',
        workspace
      })
    } else if (this.props.authenticationProvider.isSignedIn()) {
      activeComponent = $(PortalListComponent, {
        ref: 'portalListComponent',
        localUserIdentity: authenticationProvider.getIdentity(),
        portalBindingManager,
        clipboard,
        commandRegistry
      })
    } else {
      activeComponent = $(SignInComponent, {
        ref: 'signInComponent',
        authenticationProvider,
        commandRegistry
      })
    }

    return $.div({className: 'TeletypePopoverComponent'}, activeComponent)
  }
}
