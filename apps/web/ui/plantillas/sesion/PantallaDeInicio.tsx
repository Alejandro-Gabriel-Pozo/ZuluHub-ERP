import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Aviso } from "../../componentes/Aviso";
import { Pila } from "../../primitivas/Pila";
import { Texto } from "../../primitivas/Texto";
import estilos from "./PantallaDeInicio.module.css";
import { textoDeEstadoDeEmpresa, type EmpresaParaMostrar } from "./textos-de-empresa";

/** Algo que falta hacer en la empresa; lo aporta cada módulo (en v1 [FAC]: datos fiscales, punto de venta, certificado). */
export type Pendiente = Readonly<{
  id: string;
  titulo: string;
  detalle?: string;
  href: string;
}>;

export type PropsDePantallaDeInicio = Readonly<{
  empresa: EmpresaParaMostrar;
  /** La ranura «lo que falta»: la llenan los módulos. La llena Configuración fiscal cuando falta algo. */
  pendientes: readonly Pendiente[];
  diccionario?: DiccionarioResuelto;
}>;

/** El panel de inicio: dónde estás, si la empresa opera y la ranura de «lo que falta». */
export function PantallaDeInicio({
  empresa,
  pendientes,
  diccionario = {},
}: PropsDePantallaDeInicio) {
  const noOpera = textoDeEstadoDeEmpresa(empresa.estadoEfectivo, diccionario);
  return (
    <Pila separacion={5}>
      <Texto variante="subtitulo">
        {texto(diccionario, "inicio.bienvenida", { empresa: empresa.nombre })}
      </Texto>
      {noOpera === null ? null : (
        <Aviso tono="aviso">
          <Texto>{noOpera}</Texto>
        </Aviso>
      )}
      <section aria-labelledby="pendientes-titulo">
        <Pila separacion={3}>
          <Texto como="h2" variante="subtitulo" id="pendientes-titulo">
            {texto(diccionario, "inicio.pendientes_titulo")}
          </Texto>
          {pendientes.length === 0 ? (
            <Texto variante="suave">{texto(diccionario, "inicio.pendientes_vacio")}</Texto>
          ) : (
            <ul className={estilos["lista"]}>
              {pendientes.map((pendiente) => (
                <li key={pendiente.id}>
                  <a className={estilos["pendiente"]} href={pendiente.href}>
                    <span className={estilos["titulo"]}>{pendiente.titulo}</span>
                    {pendiente.detalle === undefined ? null : <span>{pendiente.detalle}</span>}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Pila>
      </section>
    </Pila>
  );
}
