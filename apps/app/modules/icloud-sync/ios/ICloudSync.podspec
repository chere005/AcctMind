Pod::Spec.new do |s|
  s.name           = 'ICloudSync'
  s.version        = '1.0.0'
  s.summary        = "AcctMind's iCloud key-value sync"
  s.description    = 'Mirrors the ledger into NSUbiquitousKeyValueStore so the phone and the Mac agree without a server.'
  s.author         = 'Sean Cheren'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
