"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Aviso } from "../../web/ui/componentes/Aviso";
import { Boton } from "../../web/ui/componentes/Boton.cliente";
import { Campo } from "../../web/ui/componentes/Campo";
import { Insignia, type TonoDeEstado } from "../../web/ui/componentes/Insignia";
import { Selector } from "../../web/ui/componentes/Selector";
import { Texto } from "../../web/ui/primitivas/Texto";
import {
  SUPERFICIES_DE_ALTA,
  TITULARES_DE_ALTA,
  type DominioParaLaPantalla,
  type EmpresaParaElSelector,
  type PedidoDeDominio,
} from "../logica/cambio-de-dominio";
import type { ErrorParaLaPantalla } from "../logica/errores-de-plataforma";
import { textoDePlanes } from "../logica/textos-de-planes";
import estilos from "./lista-de-dominios.module.css";
import { useCambioDeDominio } from "./usar-cambio-de-dominio.cliente";

export type PropsDeListaDeDominios = Readonly<{
  dominios: readonly DominioParaLaPantalla[];
  empresas: readonly EmpresaParaElSelector[];
  /** Solo una ayuda para no ofrecer los botones: el guard y el segundo factor deciden al enviar. */
  puedeEditar: boolean;
}>;

type Formulario =
  | Readonly<{ tipo: "AGREGAR" }>
  | Readonly<{ tipo: "RETIRAR"; dominio: DominioParaLaPantalla }>
  | null;

const TEXTO_NO_PERMITIDO = "Esta acción no está permitida";

const ESTADOS = {
  PENDIENTE_VERIFICACION: { tono: "aviso", clave: "plataforma.dominios.estado_pendiente" },
  VERIFICADO: { tono: "info", clave: "plataforma.dominios.estado_verificado" },
  ACTIVO: { tono: "exito", clave: "plataforma.planes.estado_activo" },
  RETIRADO: { tono: "peligro", clave: "plataforma.planes.estado_retirado" },
} as const satisfies Record<
  DominioParaLaPantalla["estado"],
  Readonly<{ tono: TonoDeEstado; clave: Parameters<typeof textoDePlanes>[0] }>
>;

const EXITO = {
  AGREGAR: "plataforma.dominios.exito_agregado",
  VERIFICAR: "plataforma.dominios.exito_verificado",
  ACTIVAR: "plataforma.dominios.exito_activado",
  DESACTIVAR: "plataforma.dominios.exito_desactivado",
  RETIRAR: "plataforma.dominios.exito_retirado",
} as const satisfies Record<PedidoDeDominio["tipo"], Parameters<typeof textoDePlanes>[0]>;

/** El error que va en el formulario: el del nombre del sitio o el del motivo debajo de su campo y todo lo demás arriba, sin códigos técnicos. */
function textoDelError(error: ErrorParaLaPantalla): {
  host?: string;
  motivo?: string;
  general?: string;
} {
  switch (error.tipo) {
    case "CAMPO":
      return error.campo === "host"
        ? { host: error.texto }
        : error.campo === "motivo"
          ? { motivo: error.texto }
          : { general: error.texto };
    case "GENERAL":
    case "PANTALLA_VIEJA":
    case "MARCA_RETIRADA":
      return { general: error.texto };
    default:
      return { general: TEXTO_NO_PERMITIDO };
  }
}

/**
 * Los dominios de las empresas: verlos, agregar uno, verificarlo, activarlo, desactivarlo y retirarlo. Nada se borra. Cada cambio usa una clave de idempotencia por
 * intento y, si el servidor pide el segundo factor reciente, abre la ventana del código y repite el mismo pedido. «Verificar» todavía no consulta el DNS: deja
 * constancia de que quien opera ya comprobó el registro (el plan de dominio propio lo automatiza después).
 */
export function ListaDeDominios({ dominios, empresas, puedeEditar }: PropsDeListaDeDominios) {
  const router = useRouter();
  const [, enTransicion] = useTransition();
  const [formulario, setFormulario] = useState<Formulario>(null);
  const [empresaId, setEmpresaId] = useState("");
  const [host, setHost] = useState("");
  const [superficie, setSuperficie] = useState("");
  const [titular, setTitular] = useState("");
  const [motivo, setMotivo] = useState("");
  const [ultimo, setUltimo] = useState<PedidoDeDominio["tipo"] | null>(null);
  const { envio, pedir, referenciaIncierta, ventana } = useCambioDeDominio();

  const estado = envio.estado;
  const incierto = estado.tipo === "incierto";
  const hecho = estado.tipo === "hecho";
  const bloqueado = !puedeEditar || envio.enCurso || incierto;
  const rechazo = estado.tipo === "rechazado" ? estado.rechazo : null;
  const error = rechazo?.tipo === "ERROR" ? textoDelError(rechazo.error) : null;
  const referencia = rechazo?.tipo === "ERROR" ? rechazo.referencia : referenciaIncierta;

  // Hecho el cambio: la lista se vuelve a pedir al servidor (con los estados nuevos) y el formulario deja de verse; el próximo `abrir` lo reinicia.
  useEffect(() => {
    if (!hecho) return;
    enTransicion(() => {
      router.refresh();
    });
  }, [hecho, router]);
  const formularioAbierto = formulario !== null && !hecho;

  const abrir = (nuevo: Formulario) => {
    envio.reiniciar();
    setUltimo(null);
    setEmpresaId("");
    setHost("");
    setSuperficie("");
    setTitular("");
    setMotivo("");
    setFormulario(nuevo);
  };

  /**
   * Manda un pedido. Con uno en vuelo (o incierto) no hace nada: ni pisa el pedido fijado ni cambia el aviso. Un pedido de una FILA cierra el formulario que haya quedado abierto o
   * resuelto: si no, al fallar este el formulario viejo reaparecería y reenviarlo repetiría un alta o un retiro ya hechos (`HOST_DUPLICADO`). El del propio formulario lo deja
   * abierto: su error se muestra ahí.
   */
  const mandar = (pedido: PedidoDeDominio, desdeElFormulario = false) => {
    if (!pedir(pedido)) return;
    if (!desdeElFormulario) setFormulario(null);
    setUltimo(pedido.tipo);
  };

  const guardar = () => {
    if (formulario === null) return;
    if (formulario.tipo === "AGREGAR") {
      const s = SUPERFICIES_DE_ALTA.find((x) => x === superficie);
      const t = TITULARES_DE_ALTA.find((x) => x === titular);
      if (s === undefined || t === undefined || empresaId === "") return;
      mandar({ tipo: "AGREGAR", empresaId, host, superficie: s, titular: t }, true);
      return;
    }
    mandar({ tipo: "RETIRAR", dominioId: formulario.dominio.id, motivo }, true);
  };

  const rotuloDeSuperficie = (s: DominioParaLaPantalla["superficie"]) =>
    textoDePlanes(
      s === "APP" ? "plataforma.dominios.superficie_app" : "plataforma.dominios.superficie_carta",
    );
  const rotuloDeTitular = (t: DominioParaLaPantalla["titular"]) =>
    textoDePlanes(
      t === "CLIENTE"
        ? "plataforma.dominios.titular_cliente"
        : "plataforma.dominios.titular_operador",
    );
  const etiquetaEmpresa = textoDePlanes("plataforma.dominios.col_empresa");
  const etiquetaSuperficie = textoDePlanes("plataforma.dominios.col_superficie");
  const etiquetaTitular = textoDePlanes("plataforma.dominios.col_titular");

  return (
    <div className={estilos["pantalla"]}>
      <div className={estilos["cabecera"]}>
        <Texto como="h2" variante="subtitulo">
          {textoDePlanes("plataforma.dominios.titulo")}
        </Texto>
        {puedeEditar ? (
          <Boton
            alTocar={() => {
              abrir({ tipo: "AGREGAR" });
            }}
            deshabilitado={bloqueado}
          >
            {textoDePlanes("plataforma.dominios.agregar")}
          </Boton>
        ) : null}
      </div>

      {hecho && ultimo !== null ? (
        <Aviso tono="exito">
          <Texto>{textoDePlanes(EXITO[ultimo])}</Texto>
        </Aviso>
      ) : null}

      {!formularioAbierto ? null : (
        <form
          className={estilos["formulario"]}
          onSubmit={(evento) => {
            evento.preventDefault();
            guardar();
          }}
        >
          <Texto como="h3" variante="subtitulo">
            {formulario?.tipo === "AGREGAR"
              ? textoDePlanes("plataforma.dominios.agregar")
              : textoDePlanes("plataforma.dominios.retirar")}
          </Texto>
          {formulario?.tipo === "AGREGAR" ? (
            <>
              <Selector
                dato="empresa-del-dominio"
                etiqueta={etiquetaEmpresa}
                textoDeElegir={etiquetaEmpresa}
                valor={empresaId}
                alCambiar={setEmpresaId}
                opciones={empresas.map((e) => ({ valor: e.id, etiqueta: e.razonSocial }))}
                deshabilitado={envio.enCurso || incierto}
                requerido
              />
              <Campo
                dato="host-de-dominio"
                etiqueta={textoDePlanes("plataforma.dominios.col_host")}
                valor={host}
                alCambiar={setHost}
                autoComplete="off"
                error={error?.host}
                deshabilitado={envio.enCurso || incierto}
              />
              <Selector
                dato="superficie-de-dominio"
                etiqueta={etiquetaSuperficie}
                textoDeElegir={etiquetaSuperficie}
                valor={superficie}
                alCambiar={setSuperficie}
                opciones={SUPERFICIES_DE_ALTA.map((s) => ({
                  valor: s,
                  etiqueta: rotuloDeSuperficie(s),
                }))}
                deshabilitado={envio.enCurso || incierto}
                requerido
              />
              <Selector
                dato="titular-de-dominio"
                etiqueta={etiquetaTitular}
                textoDeElegir={etiquetaTitular}
                valor={titular}
                alCambiar={setTitular}
                opciones={TITULARES_DE_ALTA.map((t) => ({
                  valor: t,
                  etiqueta: rotuloDeTitular(t),
                }))}
                deshabilitado={envio.enCurso || incierto}
                requerido
              />
            </>
          ) : (
            <>
              <Texto>{formulario?.dominio.host}</Texto>
              <Campo
                dato="motivo-de-retiro-de-dominio"
                etiqueta={textoDePlanes("plataforma.planes.motivo")}
                valor={motivo}
                alCambiar={setMotivo}
                autoComplete="off"
                error={error?.motivo}
                deshabilitado={envio.enCurso || incierto}
              />
            </>
          )}
          {error?.general === undefined ? null : (
            <Aviso tono="peligro">
              <Texto>{error.general}</Texto>
            </Aviso>
          )}
          <div className={estilos["botones"]}>
            <Boton
              tipo="submit"
              enviando={envio.enCurso}
              deshabilitado={!envio.enCurso && bloqueado}
            >
              {formulario?.tipo === "AGREGAR"
                ? textoDePlanes("plataforma.dominios.confirmar_agregar")
                : textoDePlanes("plataforma.dominios.retirar")}
            </Boton>
            <Boton
              variante="secundaria"
              alTocar={() => {
                abrir(null);
              }}
              deshabilitado={envio.enCurso}
            >
              {textoDePlanes("plataforma.planes.cancelar")}
            </Boton>
          </div>
        </form>
      )}

      {formularioAbierto || error?.general === undefined ? null : (
        <Aviso tono="peligro">
          <Texto>{error.general}</Texto>
        </Aviso>
      )}
      {incierto && !envio.enCurso ? (
        <div className={estilos["botones"]}>
          <Boton variante="secundaria" alTocar={envio.enviar}>
            Reintentar
          </Boton>
          {referencia === undefined ? null : <Texto>Código de referencia: {referencia}</Texto>}
        </div>
      ) : null}

      {dominios.length === 0 ? (
        <Texto variante="suave">{textoDePlanes("plataforma.dominios.vacio")}</Texto>
      ) : (
        <ul className={estilos["valores"]}>
          {dominios.map((d) => {
            const e = ESTADOS[d.estado];
            return (
              <li key={d.id} className={estilos["valor"]}>
                <div className={estilos["detalle"]}>
                  <div className={estilos["pastillas"]}>
                    <span className={estilos["nombre"]}>
                      <Texto variante="subtitulo">{d.host}</Texto>
                    </span>
                    <Insignia tono={e.tono}>{textoDePlanes(e.clave)}</Insignia>
                  </div>
                  <Texto variante="suave">
                    {d.empresa} · {rotuloDeSuperficie(d.superficie)} · {rotuloDeTitular(d.titular)}
                  </Texto>
                  {d.verificadoEn === null ? null : (
                    <Texto variante="suave">
                      {textoDePlanes("plataforma.dominios.verificado_el", {
                        fecha: d.verificadoEn,
                      })}
                    </Texto>
                  )}
                  {d.estado === "RETIRADO" && d.motivo !== null ? (
                    <Texto variante="suave">
                      {textoDePlanes("plataforma.planes.motivo_de", { motivo: d.motivo })}
                    </Texto>
                  ) : null}
                </div>
                {puedeEditar && d.estado !== "RETIRADO" ? (
                  <div className={estilos["botones"]}>
                    {d.estado === "PENDIENTE_VERIFICACION" ? (
                      <Boton
                        variante="secundaria"
                        alTocar={() => {
                          mandar({ tipo: "VERIFICAR", dominioId: d.id });
                        }}
                        deshabilitado={bloqueado}
                      >
                        {textoDePlanes("plataforma.dominios.verificar")}
                      </Boton>
                    ) : null}
                    {d.estado === "VERIFICADO" ? (
                      <Boton
                        alTocar={() => {
                          mandar({ tipo: "ACTIVAR", dominioId: d.id });
                        }}
                        deshabilitado={bloqueado}
                      >
                        {textoDePlanes("plataforma.dominios.activar")}
                      </Boton>
                    ) : null}
                    {d.estado === "ACTIVO" ? (
                      <Boton
                        variante="secundaria"
                        alTocar={() => {
                          mandar({ tipo: "DESACTIVAR", dominioId: d.id });
                        }}
                        deshabilitado={bloqueado}
                      >
                        {textoDePlanes("plataforma.dominios.desactivar")}
                      </Boton>
                    ) : null}
                    <Boton
                      variante="secundaria"
                      alTocar={() => {
                        abrir({ tipo: "RETIRAR", dominio: d });
                      }}
                      deshabilitado={bloqueado}
                    >
                      {textoDePlanes("plataforma.dominios.retirar")}
                    </Boton>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {ventana}
    </div>
  );
}
