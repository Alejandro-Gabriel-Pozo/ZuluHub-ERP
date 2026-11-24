import { EnlaceDeAccion } from "../../../componentes/EnlaceDeAccion";
import estilos from "../Compras.module.css";
import { BotonDeResolverPedido } from "./BotonDeResolverPedido.cliente";
import { HojaDeCambioDeFicha } from "./HojaDeCambioDeFicha.cliente";
import { HojaDeDejarDeUsar } from "./HojaDeDejarDeUsar.cliente";
import {
  armarLaFichaDelProveedor,
  digitosDelPuntoDeVenta,
  rutaDeLaFichaDelProveedor,
  type AccionesDeLaFichaParaLaPantalla,
  type FichaDelProveedorParaLaPantalla,
} from "./modelo-de-ficha-de-proveedor";
import type { ResultadoDeFichaDeProveedor } from "./resultado-de-proveedor";
import type { TextosDeProveedor } from "./textos-de-proveedor";

type Accion = (
  previo: ResultadoDeFichaDeProveedor,
  datos: FormData,
) => Promise<ResultadoDeFichaDeProveedor>;

/** Las acciones de servidor ya ligadas al proveedor (`.bind` en la página): la pantalla no conoce ids de otra cosa que lo que dibuja. */
export type AccionesLigadasDeLaFicha = Readonly<{
  agregarPuntoDeVenta: Accion;
  pedirPuntoDeVenta: Accion;
  agregarComprobante: Accion;
  pedirComprobante: Accion;
  dejarDeUsarPuntoDeVenta: (numero: number) => Accion;
  dejarDeUsarComprobante: (tipo: string) => Accion;
  resolverPedido: (pedidoId: string, decision: "APROBAR" | "RECHAZAR") => Accion;
}>;

export type PropsDePantallaDeFichaDeProveedor = Readonly<{
  ficha: FichaDelProveedorParaLaPantalla;
  permisos: AccionesDeLaFichaParaLaPantalla;
  acciones: AccionesLigadasDeLaFicha;
  textos: TextosDeProveedor;
}>;

/**
 * La ficha del proveedor de compras (maqueta `compra.html`, estado `proveedor`; Compras PR 4): los datos del directorio, los comprobantes que emite, los puntos de venta, los pedidos pendientes (solo si
 * hay), lo que se le compra y las últimas facturas. Sin estado ni hooks: es una página de servidor; los botones que escriben son componentes de cliente (hojas). Quien edita ve «Agregar», «Dejar de usar»,
 * «Aprobar» y «Rechazar»; quien solo carga compras ve «Pedir»; sin ninguno de los dos permisos, no hay botones (todo nace cerrado). El `h1` (el nombre del proveedor) lo pone el armazón.
 */
export function PantallaDeFichaDeProveedor({
  ficha,
  permisos,
  acciones,
  textos,
}: PropsDePantallaDeFichaDeProveedor) {
  const f = armarLaFichaDelProveedor(ficha, textos);
  const rutaDeLaFicha = rutaDeLaFichaDelProveedor(ficha.parteId);
  const comunes = {
    textoDeCancelar: textos.cancelar,
    textoDeCerrar: textos.cerrar,
    rutaDeLaFicha,
  };
  const digitos = digitosDelPuntoDeVenta(ficha.puntoDeVentaMaximo);
  return (
    <div className={estilos["cuerpo"]}>
      <EnlaceDeAccion href={f.volver.href} variante="secundaria">
        {f.volver.texto}
      </EnlaceDeAccion>
      <section className={estilos["tarjeta"]}>
        <h3 className={estilos["seccion"]}>{f.datos.titulo}</h3>
        <p className={estilos["renglon"]}>{f.datos.nombre}</p>
        {f.datos.cuit === null ? null : <p className={estilos["renglon"]}>{f.datos.cuit}</p>}
        {f.datos.condicion === null ? null : (
          <p className={estilos["suave"]}>{f.datos.condicion}</p>
        )}
      </section>
      <section className={estilos["tarjeta"]}>
        <h3 className={estilos["seccion"]}>{f.comprobantes.titulo}</h3>
        <p className={estilos["renglon"]}>{f.comprobantes.valor}</p>
        <p className={estilos["suave"]}>{f.comprobantes.porCondicion}</p>
        {permisos.editar
          ? f.comprobantes.quitables.map((c) => (
              <HojaDeDejarDeUsar
                key={c.tipo}
                verbo={textos.dejarDeUsar}
                objeto={c.nombre}
                descripcion={textos.lasFacturasCargadasNoCambian}
                accion={acciones.dejarDeUsarComprobante(c.tipo)}
                {...comunes}
              />
            ))
          : null}
        {permisos.editar || permisos.pedir ? (
          <HojaDeCambioDeFicha
            campo={{
              tipo: "COMPROBANTE",
              etiqueta: textos.tipo,
              opciones: f.comprobantes.agregables,
            }}
            titulo={permisos.editar ? textos.agregarOtroComprobante : textos.pedirOtroComprobante}
            descripcion={
              permisos.editar
                ? [`${textos.seAgregaALaFichaDe} ${f.datos.nombre}.`]
                : [`${textos.pedidoLoApruebaQuienAdministra}.`]
            }
            textoDeEnviar={permisos.editar ? textos.agregar : textos.enviarPedido}
            accion={permisos.editar ? acciones.agregarComprobante : acciones.pedirComprobante}
            {...comunes}
          />
        ) : null}
      </section>
      <section className={estilos["tarjeta"]}>
        <h3 className={estilos["seccion"]}>{f.puntosDeVenta.titulo}</h3>
        {f.puntosDeVenta.vacio === null ? null : (
          <p className={estilos["suave"]}>{f.puntosDeVenta.vacio}</p>
        )}
        {f.puntosDeVenta.numeros.map((p) => (
          <div key={p.numero} className={estilos["renglon"]}>
            <span>{p.texto}</span>
            {permisos.editar ? (
              <HojaDeDejarDeUsar
                verbo={textos.dejarDeUsar}
                objeto={p.texto}
                descripcion={textos.lasFacturasCargadasNoCambian}
                accion={acciones.dejarDeUsarPuntoDeVenta(p.numero)}
                {...comunes}
              />
            ) : null}
          </div>
        ))}
        {permisos.editar || permisos.pedir ? (
          <HojaDeCambioDeFicha
            campo={{
              tipo: "PUNTO_DE_VENTA",
              etiqueta: textos.numeroDelPuntoDeVenta,
              digitos,
            }}
            titulo={permisos.editar ? textos.agregarPuntoDeVenta : textos.pedirPuntoDeVenta}
            descripcion={
              permisos.editar
                ? [
                    `${textos.seAgregaALaFichaDe} ${f.datos.nombre}.`,
                    `${textos.despuesSoloSeEligeEntreLosDeLaFicha}.`,
                  ]
                : [`${textos.pedidoLoApruebaQuienAdministra}.`]
            }
            textoDeEnviar={permisos.editar ? textos.agregar : textos.enviarPedido}
            accion={permisos.editar ? acciones.agregarPuntoDeVenta : acciones.pedirPuntoDeVenta}
            {...comunes}
          />
        ) : null}
      </section>
      {f.pedidos === null ? null : (
        <section className={estilos["tarjeta"]}>
          <h3 className={estilos["seccion"]}>{f.pedidos.titulo}</h3>
          {f.pedidos.filas.map((p) => (
            <div key={p.id} className={estilos["linea"]}>
              <span className={estilos["titulo"]}>{p.nombre}</span>
              <span className={estilos["detalle"]}>{p.fecha}</span>
              {permisos.editar ? (
                <>
                  <BotonDeResolverPedido
                    accion={acciones.resolverPedido(p.id, "RECHAZAR")}
                    texto={textos.rechazar}
                    variante="secundaria"
                    rutaDeLaFicha={rutaDeLaFicha}
                  />
                  <BotonDeResolverPedido
                    accion={acciones.resolverPedido(p.id, "APROBAR")}
                    texto={textos.aprobar}
                    rutaDeLaFicha={rutaDeLaFicha}
                  />
                </>
              ) : (
                <span className={estilos["detalle"]}>{textos.faltaQueLoApruebe}</span>
              )}
            </div>
          ))}
        </section>
      )}
      <section className={estilos["tarjeta"]}>
        <h3 className={estilos["seccion"]}>{f.queLeCompramos.titulo}</h3>
        {f.queLeCompramos.vacio === null ? null : (
          <p className={estilos["suave"]}>{f.queLeCompramos.vacio}</p>
        )}
        {f.queLeCompramos.filas.map((o) => (
          <div key={o.clave} className={estilos["linea"]}>
            <span className={estilos["titulo"]}>{o.nombre}</span>
            <span className={estilos["importe"]}>{o.precio}</span>
            <span className={estilos["detalle"]}>{o.ultima}</span>
          </div>
        ))}
      </section>
      <section className={estilos["tarjeta"]}>
        <h3 className={estilos["seccion"]}>{f.facturas.titulo}</h3>
        {f.facturas.vacio === null ? null : <p className={estilos["suave"]}>{f.facturas.vacio}</p>}
        {f.facturas.filas.map((x) => (
          <div key={x.clave} className={estilos["linea"]}>
            <span className={estilos["titulo"]}>{x.nombre}</span>
            <span className={estilos["importe"]}>{x.total}</span>
            <span className={estilos["detalle"]}>{x.segunda}</span>
          </div>
        ))}
        {f.facturas.verTodas === null ? null : (
          <EnlaceDeAccion href={f.facturas.verTodas.href} variante="secundaria">
            {f.facturas.verTodas.texto}
          </EnlaceDeAccion>
        )}
      </section>
    </div>
  );
}
