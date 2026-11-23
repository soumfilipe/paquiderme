// Partes do ambiente do app que as telas leem: aviso de saúde da instância, estado dos avisos push, preferências e
// instâncias salvas em Explorar > Outras. Reativas: quem muda aqui atualiza as telas sem avisar ninguém.
export const ambiente = $state({
	alarme: '',
	push: { loading: false, supported: false, standalone: false, sub: null, error: null, loaded: false },
	prefs: {},
	outras: []
});
