Pod::Spec.new do |s|
  s.name           = 'PeerSync'
  s.version        = '1.0.0'
  s.summary        = "AcctMind's device-to-device sync over the local network"
  s.description    = 'Bonjour discovery and a TLS-PSK link, so two of the same person\'s devices can trade ledgers with no server and no paid Apple membership.'
  s.author         = 'Sean Cheren'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
