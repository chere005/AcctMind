Pod::Spec.new do |s|
  s.name           = 'ICloudFile'
  s.version        = '1.0.0'
  s.summary        = "AcctMind's shared file in iCloud Drive"
  s.description    = 'Reads and writes one JSON document in the app\'s ubiquity container, so every surface — including the Tauri Mac shell, which has no native modules at all — sees the same ledger.'
  s.author         = 'Sean Cheren'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
