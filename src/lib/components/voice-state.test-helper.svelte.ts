// A stand-in for the voice state in component tests: voice on, idle.
export const voice = $state({
	available: true,
	phase: 'idle' as 'idle' | 'listening' | 'transcribing',
	level: 0,
	speaking: false,
	error: ''
});
