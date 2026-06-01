export interface PlantUMLOptions {
  command: string
  cache: boolean
  cacheDir?: string
}
export declare function plantuml(userOpts?: Partial<PlantUMLOptions>): {
  name: string
  markdownPlugins(): unknown[]
}
