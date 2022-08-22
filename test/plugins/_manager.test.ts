import { PluginManager } from '../../src/plugins/_manager';

test('asd', () => {

  PluginManager.load({ spec: 'markmac', version: '0.1.344', class: 'App', properties: new Map() });

});