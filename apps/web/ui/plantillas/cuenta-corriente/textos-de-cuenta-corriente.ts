import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";

/**
 * Los textos de la cuenta corriente de clientes ya resueltos (CC-5, A1): el listado y la ficha. Cada texto sale del catálogo con su fuente (`catalogo-cuenta_corriente.ts` y los que ya existían). Lo que no tiene
 * texto aprobado NO se escribe acá. Los que llevan datos (`{n} días`, `Ticket {n} · …`) los resuelve el modelo con sus valores.
 */
export type TextosDeCuentaCorriente = Readonly<{
  entrada: string;
  titulo: string;
  ordenarPorSaldo: string;
  ordenarPorVencido: string;
  ordenarPorAntiguedad: string;
  cliente: string;
  estado: string;
  saldo: string;
  vencido: string;
  limite: string;
  creditoDisponible: string;
  cargoMasAntiguo: string;
  habilitada: string;
  suspendida: string;
  excedida: string;
  limiteDeCredito: string;
  plazo: string;
  fecha: string;
  movimiento: string;
  origenDelMovimiento: string;
  vence: string;
  importe: string;
  ventaACuenta: string;
  ventaAnulada: string;
  anulacion: string;
  vencida: string;
  cuentaSuspendida: string;
  sinResultados: string;
  salon: string;
  mostrador: string;
}>;

export function textosDeCuentaCorriente(): TextosDeCuentaCorriente {
  return {
    entrada: texto({}, "cuenta_corriente.menu.entrada"),
    titulo: texto({}, "cuenta_corriente.lista.titulo"),
    ordenarPorSaldo: texto({}, "cuenta_corriente.lista.ordenar_por_saldo"),
    ordenarPorVencido: texto({}, "cuenta_corriente.lista.ordenar_por_vencido"),
    ordenarPorAntiguedad: texto({}, "cuenta_corriente.lista.ordenar_por_antiguedad"),
    cliente: texto({}, "fiscal.pantalla.rotulo_cliente"),
    estado: texto({}, "fiscal.pantalla.listado_rotulo_estado"),
    saldo: texto({}, "cuenta_corriente.lista.saldo"),
    vencido: texto({}, "cuenta_corriente.lista.vencido"),
    limite: texto({}, "cuenta_corriente.lista.limite"),
    creditoDisponible: texto({}, "cuenta_corriente.credito_disponible"),
    cargoMasAntiguo: texto({}, "cuenta_corriente.lista.cargo_mas_antiguo"),
    habilitada: texto({}, "cuenta_corriente.estado.habilitada"),
    suspendida: texto({}, "cuenta_corriente.estado.suspendida"),
    excedida: texto({}, "cuenta_corriente.estado.excedida"),
    limiteDeCredito: texto({}, "cuenta_corriente.ficha.limite_de_credito"),
    plazo: texto({}, "cuenta_corriente.ficha.plazo"),
    fecha: texto({}, "fiscal.pantalla.rotulo_fecha"),
    movimiento: texto({}, "cuenta_corriente.movimiento.movimiento"),
    origenDelMovimiento: texto({}, "cuenta_corriente.movimiento.origen_del_movimiento"),
    vence: texto({}, "compras.control.vence"),
    importe: texto({}, "ventas.cobro.importe"),
    ventaACuenta: texto({}, "cuenta_corriente.movimiento.venta_a_cuenta"),
    ventaAnulada: texto({}, "cuenta_corriente.movimiento.venta_anulada"),
    anulacion: texto({}, "caja.movimiento.anulacion"),
    vencida: texto({}, "cuenta_corriente.movimiento.vencida"),
    cuentaSuspendida: texto({}, "cuenta_corriente.ficha.suspendida"),
    sinResultados: texto({}, "catalogo.lista.sin_resultados"),
    salon: texto({}, "salon.texto.grupo_salon"),
    mostrador: texto({}, "navegacion.grupo.mostrador"),
  };
}
