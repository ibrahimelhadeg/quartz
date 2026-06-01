import type { QuartzComponent, QuartzComponentConstructor } from '@quartz-community/types';
export interface D3Config {
  drag: boolean; zoom: boolean; depth: number; scale: number;
  repelForce: number; centerForce: number; linkDistance: number;
  fontSize: number; opacityScale: number; removeTags: string[]; showTags: boolean;
  focusOnHover?: boolean; enableRadial?: boolean; showLabels?: boolean; legend?: boolean;
}
export interface GraphOptions {
  localGraph?: Partial<D3Config>;
  globalGraph?: Partial<D3Config>;
}
declare const _default: QuartzComponentConstructor<Partial<GraphOptions>>;
export default _default;
export declare const Graph: QuartzComponent;
