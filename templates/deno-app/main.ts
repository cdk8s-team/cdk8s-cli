import { App, Chart, ChartProps, Construct } from './deps.ts';

export class MyChart extends Chart {
  constructor(scope: Construct, id: string, props: ChartProps = { }) {
    super(scope, id, props);

    // define resources here

  }
}

const app = new App();
new MyChart(app, '{{ $base }}');
app.synth();
