/**
 * 类型安全的延迟绑定持有器：用于打破构造期循环依赖。
 *
 * 取代 `null as unknown as T` 占位——后者会把未初始化的 null 伪装成已就绪的 T，
 * 一旦闭包在 set 之前被同步调用就是无声的 NPE。LateBound 在未就绪时显式抛错，
 * 把「构造顺序错误」从隐性崩溃变成可定位的失败。
 */
export class LateBound<T> {
  private value: T | undefined;
  private bound = false;

  constructor(private readonly name: string) {}

  set(value: T): void {
    this.value = value;
    this.bound = true;
  }

  isBound(): boolean {
    return this.bound;
  }

  get(): T {
    if (!this.bound) {
      throw new Error(`LateBound<${this.name}> accessed before initialization`);
    }
    return this.value as T;
  }
}
