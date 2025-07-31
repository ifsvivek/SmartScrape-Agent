<script>
	let query = '';
	let results = null;
	let loading = false;
	let error = null;
	let exporting = false;

	async function handleScrape() {
		if (!query.trim()) return;

		loading = true;
		error = null;
		results = null;

		try {
			const response = await fetch('/api/scrape', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ query })
			});

			const data = await response.json();

			if (!response.ok) {
				throw new Error(data.error || 'Failed to scrape');
			}

			results = data;
		} catch (err) {
			error = err.message;
			console.error('Scraping error:', err);
		} finally {
			loading = false;
		}
	}

	async function handleExportCSV() {
		if (!results?.aiAgent?.selectorsUsed || !results?.url) {
			error = 'No valid data to export';
			return;
		}

		exporting = true;
		error = null;

		try {
			const response = await fetch('/api/scrape', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					action: 'export',
					selectors: results.aiAgent.selectorsUsed,
					url: results.url
				})
			});

			if (response.ok) {
				// Get the CSV content and trigger download
				const csvContent = await response.text();
				const blob = new Blob([csvContent], { type: 'text/csv' });
				const url = window.URL.createObjectURL(blob);
				const a = document.createElement('a');
				const timestamp = new Date().toISOString().split('T')[0];
				a.href = url;
				a.download = `scraped-data-${timestamp}.csv`;
				document.body.appendChild(a);
				a.click();
				window.URL.revokeObjectURL(url);
				document.body.removeChild(a);
			} else {
				const errorData = await response.json();
				error = errorData.error || 'Export failed';
			}
		} catch (err) {
			error = 'Export error: ' + err.message;
		} finally {
			exporting = false;
		}
	}

	function handleKeyPress(event) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			handleScrape();
		}
	}
</script>

<svelte:head>
	<title>SmartScrape Agent</title>
	<meta name="description" content="AI-powered web scraping tool" />
</svelte:head>

<div class="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
	<div class="mx-auto max-w-4xl">
		<!-- Header -->
		<header class="py-8 text-center">
			<h1 class="mb-2 text-4xl font-bold text-gray-800">SmartScrape Agent</h1>
			<p class="text-gray-600">AI-powered web scraping with natural language</p>
		</header>

		<!-- Input Form -->
		<div class="mb-6 rounded-lg bg-white p-6 shadow-lg">
			<label for="query" class="mb-2 block text-sm font-medium text-gray-700">
				Describe what you want to scrape:
			</label>
			<div class="flex gap-4">
				<textarea
					id="query"
					bind:value={query}
					on:keypress={handleKeyPress}
					placeholder="Example: Extract the latest 10 technology articles from TechCrunch with their titles, authors, and publication dates"
					class="flex-1 resize-none rounded-md border border-gray-300 p-3 focus:border-transparent focus:ring-2 focus:ring-blue-500"
					rows="3"
					disabled={loading}
				></textarea>
			</div>
			<div class="mt-4 flex items-center justify-between">
				<div class="text-sm text-gray-500">Press Enter to scrape, or Shift+Enter for new line</div>
				<button
					on:click={handleScrape}
					disabled={loading || !query.trim()}
					class="rounded-md bg-blue-600 px-6 py-2 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
				>
					{loading ? 'Scraping...' : 'Start Scraping'}
				</button>
			</div>
		</div>

		<!-- Loading State -->
		{#if loading}
			<div class="rounded-lg bg-white p-6 text-center shadow-lg">
				<div
					class="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600"
				></div>
				<p class="text-gray-600">AI is analyzing your request and scraping data...</p>
			</div>
		{/if}

		<!-- Error State -->
		{#if error}
			<div class="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
				<div class="flex">
					<div class="flex-shrink-0">
						<svg class="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
							<path
								fill-rule="evenodd"
								d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
								clip-rule="evenodd"
							/>
						</svg>
					</div>
					<div class="ml-3">
						<h3 class="text-sm font-medium text-red-800">Scraping Error</h3>
						<p class="mt-1 text-sm text-red-700">{error}</p>
					</div>
				</div>
			</div>
		{/if}

		<!-- Results -->
		{#if results}
			<div class="rounded-lg bg-white p-6 shadow-lg">
				<div class="mb-4 flex items-center justify-between">
					<h2 class="text-xl font-semibold text-gray-800">
						Scraping Results ({results.count} items found)
					</h2>
					<button
						on:click={handleExportCSV}
						disabled={exporting || !results?.aiAgent?.selectorsUsed}
						class="flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-400"
					>
						{#if exporting}
							<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
								<circle
									class="opacity-25"
									cx="12"
									cy="12"
									r="10"
									stroke="currentColor"
									stroke-width="4"
								></circle>
								<path
									class="opacity-75"
									fill="currentColor"
									d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
								></path>
							</svg>
							Extracting All Data...
						{:else}
							<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
								/>
							</svg>
							Export All to CSV
						{/if}
					</button>
				</div>

				<!-- AI Agent Info -->
				{#if results.aiAgent}
					<div class="mb-6 rounded-md bg-blue-50 p-4">
						<h3 class="mb-2 text-sm font-medium text-blue-800">🤖 AI Agent Report:</h3>
						<div class="space-y-1 text-sm text-blue-700">
							<p><strong>Attempts Used:</strong> {results.aiAgent.attemptsUsed}/3</p>
							<p>
								<strong>Success Rate:</strong>
								{(results.aiAgent.finalSuccessRate * 100).toFixed(1)}%
							</p>
							{#if results.aiAgent.message}
								<p><strong>Message:</strong> {results.aiAgent.message}</p>
							{/if}
							{#if results.aiAgent.debugInfo?.workingContainerSelector}
								<p>
									<strong>Working Container:</strong>
									<code class="rounded bg-blue-100 px-1"
										>{results.aiAgent.debugInfo.workingContainerSelector}</code
									>
								</p>
							{/if}
						</div>
					</div>
				{/if}

				<!-- Config Info -->
				<div class="mb-6 rounded-md bg-gray-50 p-4">
					<h3 class="mb-2 text-sm font-medium text-gray-700">Scraping Configuration:</h3>
					<p class="text-sm text-gray-600"><strong>URL:</strong> {results.url || 'N/A'}</p>
					{#if results.aiAgent?.selectorsUsed}
						<details class="mt-2">
							<summary class="cursor-pointer text-sm text-gray-600 hover:text-gray-800">
								<strong>AI-Generated Selectors</strong> (click to expand)
							</summary>
							<div class="mt-2 rounded bg-gray-100 p-2 text-xs">
								<pre>{JSON.stringify(results.aiAgent.selectorsUsed, null, 2)}</pre>
							</div>
						</details>
					{/if}
				</div>

				<!-- Data Table -->
				{#if results.data && results.data.length > 0}
					<div class="overflow-x-auto">
						<table class="min-w-full divide-y divide-gray-200">
							<thead class="bg-gray-50">
								<tr>
									{#each Object.keys(results.data[0]) as key}
										<th
											class="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase"
										>
											{key}
										</th>
									{/each}
								</tr>
							</thead>
							<tbody class="divide-y divide-gray-200 bg-white">
								{#each results.data as item, index}
									<tr class={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
										{#each Object.values(item) as value}
											<td class="max-w-xs truncate px-6 py-4 text-sm text-gray-900">
												{value || '-'}
											</td>
										{/each}
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{:else}
					<div class="py-8 text-center">
						<p class="text-gray-500">
							No data was extracted. Try refining your query or targeting a different website.
						</p>
					</div>
				{/if}
			</div>
		{/if}

		<!-- Examples -->
		<div class="mt-8 rounded-lg bg-white p-6 shadow-lg">
			<h3 class="mb-4 text-lg font-semibold text-gray-800">Example Queries:</h3>
			<div class="space-y-2">
				<button
					on:click={() =>
						(query = 'Extract the latest 5 articles from Hacker News with titles and scores')}
					class="block w-full rounded-md bg-gray-50 p-3 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100"
				>
					Extract the latest 5 articles from Hacker News with titles and scores
				</button>
				<button
					on:click={() =>
						(query =
							'Get the top 10 trending repositories from GitHub with names, descriptions, and star counts')}
					class="block w-full rounded-md bg-gray-50 p-3 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100"
				>
					Get the top 10 trending repositories from GitHub with names, descriptions, and star counts
				</button>
				<button
					on:click={() =>
						(query =
							'Scrape product listings from an e-commerce site with names, prices, and ratings')}
					class="block w-full rounded-md bg-gray-50 p-3 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100"
				>
					Scrape product listings from an e-commerce site with names, prices, and ratings
				</button>
			</div>
		</div>
	</div>
</div>
