module example.com/{{ $base }}

go 1.16

require (
	github.com/aws/constructs-go/constructs/v3 v{{ constructs_version }}
  github.com/aws/jsii-runtime-go v{{ jsii_version }}
	github.com/cdk8s-team/cdk8s-core-go/cdk8s v{{ cdk8s_core_version }}
)
