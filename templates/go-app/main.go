package main

import (
	"github.com/aws/constructs-go/constructs/v3"
	"github.com/cdk8s-team/cdk8s-core-go/cdk8s"
)

type MyChartProps struct {
	cdk8s.ChartProps
}

func NewMyChart(scope constructs.Construct, id string, props *MyChartProps) cdk8s.Chart {
	var sprops cdk8s.ChartProps
	if props != nil {
		sprops = props.ChartProps
	}
	chart := cdk8s.NewChart(scope, &id, &sprops)

	// define resources here

	return chart
}

func main() {
	app := cdk8s.NewApp(nil)
	NewMyChart(app, "{{ $base }}", nil)
	app.Synth()
}
