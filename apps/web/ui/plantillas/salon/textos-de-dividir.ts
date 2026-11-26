import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";

/**
 * Los textos de «Dividir la cuenta» por ítems y de la lista de cuentas hijas (SAL-E2; maquetas `salon.html` y `unir.html`, aprobadas el 09/11/2026): todos salen del catálogo (`salon.texto.dividir_*` y `salon.texto.unir_*`);
 * no se arma ninguno nuevo. Ya resueltos: viajan al navegador como datos. `cuentaN` es la plantilla «Cuenta N» (la N final es el lugar del número: `conNumero`). Chequeo: `test/web/ficha-de-dividir-la-cuenta.test.ts`.
 */
export type TextosDeDividir = Readonly<{
  dividirLaCuenta: string;
  dividirPorItems: string;
  cuentas: string;
  cuentaN: string;
  agregarCuenta: string;
  faltaAsignar: string;
  cuentaVacia: string;
  confirmarDivision: string;
  entero: string;
  porUnidades: string;
  compartido: string;
  repartir: string;
  entreCuales: string;
  centavoQueSobra: string;
  pendiente: string;
  cobrada: string;
  volverALasCuentas: string;
  mesaCobrada: string;
  cancelar: string;
  cerrar: string;
  cobrar: string;
}>;

export function textosDeDividir(d: DiccionarioResuelto = {}): TextosDeDividir {
  return {
    dividirLaCuenta: texto(d, "salon.texto.dividir_dividir_la_cuenta"),
    dividirPorItems: texto(d, "salon.texto.unir_dividir_por_items"),
    cuentas: texto(d, "salon.texto.unir_cuentas"),
    cuentaN: texto(d, "salon.texto.dividir_cuenta_n"),
    agregarCuenta: texto(d, "salon.texto.unir_agregar_cuenta"),
    faltaAsignar: texto(d, "salon.texto.unir_falta_asignar"),
    cuentaVacia: texto(d, "salon.texto.unir_cuenta_vacia"),
    confirmarDivision: texto(d, "salon.texto.unir_dividir_ahora"),
    entero: texto(d, "salon.texto.unir_entero"),
    porUnidades: texto(d, "salon.texto.unir_por_unidades"),
    compartido: texto(d, "salon.texto.unir_compartido"),
    repartir: texto(d, "salon.texto.unir_repartir"),
    entreCuales: texto(d, "salon.texto.unir_entre_cuales"),
    centavoQueSobra: texto(d, "salon.texto.unir_el_centavo_que_sobra_va_a_la_cuenta_1"),
    pendiente: texto(d, "salon.texto.dividir_pendiente"),
    cobrada: texto(d, "salon.texto.dividir_cobrada"),
    volverALasCuentas: texto(d, "salon.texto.dividir_volver_a_las_cuentas"),
    mesaCobrada: texto(d, "salon.texto.dividir_mesa_cobrada"),
    cancelar: texto(d, "ventas.venta.cancelar"),
    cerrar: texto(d, "vidriera.producto.cerrar"),
    cobrar: texto(d, "ventas.cobro.cobrar"),
  };
}

/** «Cuenta N» con su número: la plantilla termina en «N» (el lugar del número); sin esa N se agrega al final. */
export const conNumero = (plantilla: string, numero: number): string =>
  plantilla.endsWith("N")
    ? `${plantilla.slice(0, -1)}${String(numero)}`
    : `${plantilla} ${String(numero)}`;
