Pod::Spec.new do |s|
  s.name           = 'WatchBridge'
  s.version        = '1.0.0'
  s.summary        = "AcctMind's phone half of the watch link"
  s.description    = 'Pushes the ledger feed to the paired Apple Watch over WatchConnectivity.'
  s.author         = 'Sean Cheren'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
