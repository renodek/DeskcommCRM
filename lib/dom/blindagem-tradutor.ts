/**
 * Blindagem contra o conflito Chrome/Edge Translate x React.
 *
 * O tradutor embutido do navegador reescreve nós de texto diretamente no DOM,
 * fora da árvore que o React acha que administra. Quando o React comita uma
 * remoção ou reordenação (fechar um Select, trocar de etapa do onboarding,
 * a tela de QR do WhatsApp virar "conectado"), ele chama `removeChild` ou
 * `insertBefore` num nó que o tradutor já moveu ou substituiu — e o DOM
 * nativo lança `NotFoundError: Failed to execute 'removeChild' on 'Node'`.
 * Esse erro não é capturado por nenhum try/catch do React: ele estoura no
 * commit da árvore de fibra e vira o error boundary genérico da tela inteira.
 *
 * Marcar `translate="no"` componente por componente (`components/ui/*`)
 * reduz a superfície, mas nunca fecha o buraco: toda tela nova que o
 * tradutor alcançar reabre o mesmo crash. O remédio que fecha de vez é no
 * método do DOM, uma vez, para toda a árvore — presente e futura.
 *
 * O patch é conservador: só absorve exatamente os dois casos em que o nó já
 * não está mais onde o React espera (o sintoma do tradutor). Qualquer outro
 * erro de `removeChild`/`insertBefore` continua sendo lançado normalmente —
 * isto não é um "silenciador" genérico de bugs de DOM.
 */
export function blindarDomContraTradutorDoNavegador(): void {
  if (typeof window === "undefined") return;
  if (typeof Node === "undefined" || !Node.prototype) return;

  const proto = Node.prototype as Node & {
    __blindadoContraTradutor?: boolean;
  };
  // Idempotente: instrumentation-client pode rodar mais de uma vez (fast
  // refresh, navegação client-side) e o patch não deve empilhar.
  if (proto.__blindadoContraTradutor) return;
  proto.__blindadoContraTradutor = true;

  type RemoveChildFn = (this: Node, child: Node) => Node;
  type InsertBeforeFn = (this: Node, newNode: Node, referenceNode: Node | null) => Node;

  const removeChildOriginal = Node.prototype.removeChild as unknown as RemoveChildFn;
  const removeChildBlindado: RemoveChildFn = function (child) {
    if (child.parentNode !== this) {
      // O tradutor já reparentou/substituiu este nó. O React só queria que
      // ele deixasse de existir na árvore dele — o que já é verdade — então
      // devolver o nó sem lançar é o comportamento correto, não um "engolir
      // erro".
      return child;
    }
    return removeChildOriginal.call(this, child);
  };
  Node.prototype.removeChild = removeChildBlindado as unknown as typeof Node.prototype.removeChild;

  const insertBeforeOriginal = Node.prototype.insertBefore as unknown as InsertBeforeFn;
  const insertBeforeBlindado: InsertBeforeFn = function (newNode, referenceNode) {
    if (referenceNode && referenceNode.parentNode !== this) {
      // Mesma causa: a referência que o React guardou não é mais filha deste
      // nó porque o tradutor moveu algo no meio do caminho. Anexar ao fim
      // evita o crash sem perder o nó novo.
      return this.appendChild(newNode);
    }
    return insertBeforeOriginal.call(this, newNode, referenceNode);
  };
  Node.prototype.insertBefore = insertBeforeBlindado as unknown as typeof Node.prototype.insertBefore;
}
