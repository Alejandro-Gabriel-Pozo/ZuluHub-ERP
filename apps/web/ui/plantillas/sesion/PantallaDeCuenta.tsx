import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Icono } from "../../iconos/Icono";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import {
  FormularioDeAccion,
  type AccionDeFormulario,
} from "../../patrones/FormularioDeAccion.cliente";
import {
  SelectorDeSucursal,
  type SucursalParaElegir,
} from "../../patrones/SelectorDeSucursal.cliente";
import { Pila } from "../../primitivas/Pila";
import { Texto } from "../../primitivas/Texto";
import estilos from "./PantallaDeCuenta.module.css";
import { textoDelRol, type EmpresaParaMostrar } from "./textos-de-empresa";

export type PropsDePantallaDeCuenta = Readonly<{
  empresa: EmpresaParaMostrar;
  /** Las sucursales activas que la persona puede ver; vacío si no puede listarlas (el selector no aparece). */
  sucursales: readonly SucursalParaElegir[];
  accionDeCerrarSesion: AccionDeFormulario;
  diccionario?: DiccionarioResuelto;
}>;

/** `/cuenta`: la empresa y el rol, la sucursal de este dispositivo y cerrar sesión. */
export function PantallaDeCuenta({
  empresa,
  sucursales,
  accionDeCerrarSesion,
  diccionario = {},
}: PropsDePantallaDeCuenta) {
  return (
    <Pila separacion={5}>
      <dl className={estilos["datos"]}>
        <dt>{texto(diccionario, "empresa.etiqueta")}</dt>
        <dd className={estilos["valor"]}>{empresa.nombre}</dd>
        <dt>{texto(diccionario, "empresa.rol_etiqueta")}</dt>
        <dd className={estilos["valor"]}>{textoDelRol(empresa.rol, diccionario)}</dd>
      </dl>
      <SelectorDeSucursal
        empresaId={empresa.empresaId}
        sucursales={sucursales}
        diccionario={diccionario}
      />
      <Texto>
        <a className={estilos["enlace"]} href="/empresa">
          {texto(diccionario, "empresa.cambiar")}
        </a>
      </Texto>
      <FormularioDeAccion accion={accionDeCerrarSesion} diccionario={diccionario}>
        <BotonDeEnvio
          variante="secundaria"
          ancho="completo"
          textoEnviando={texto(diccionario, "cuenta.cerrando")}
        >
          <Icono clave="salir" tamano="medio" decorativo />{" "}
          {texto(diccionario, "cuenta.cerrar_sesion")}
        </BotonDeEnvio>
      </FormularioDeAccion>
    </Pila>
  );
}
