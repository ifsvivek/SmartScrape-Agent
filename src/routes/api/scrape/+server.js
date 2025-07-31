import { json } from '@sveltejs/kit';
import { GoogleGenAI } from '@google/genai';
import puppeteer from 'puppeteer';
import { GEMINI_API_KEY } from '$env/static/private';

const ai = new GoogleGenAI({
	apiKey: GEMINI_API_KEY
});

async function determineTargetWebsite(userQuery) {
	const config = {
		thinkingConfig: {
			thinkingBudget: 0
		}
	};

	const model = 'gemini-2.5-flash';
	const prompt = `
        Analyze this scraping request and determine the target website URL:
        "${userQuery}"
        
        Based on the request, identify:
        1. What type of data they want (products, articles, repositories, etc.)
        2. The most appropriate website to scrape for this data
        3. The specific URL that would contain this data
        
        Common examples:
        - "GitHub trending repositories" → "https://github.com/trending"
        - "TechCrunch articles" → "https://techcrunch.com"
        - "Hacker News posts" → "https://news.ycombinator.com"
        - "Reddit posts from programming" → "https://reddit.com/r/programming"
        - "Amazon products" → specific Amazon search/category URL
        - "eBay listings" → specific eBay search/category URL
        
        Respond with JSON only:
        {
            "url": "https://specific-website-url.com",
            "reasoning": "This URL contains the requested data type",
            "dataType": "repositories|articles|products|posts|etc"
        }
    `;

	const contents = [
		{
			role: 'user',
			parts: [{ text: prompt }]
		}
	];

	try {
		const response = await ai.models.generateContentStream({
			model,
			config,
			contents
		});

		let result = '';
		for await (const chunk of response) {
			result += chunk.text;
		}

		const jsonMatch = result.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			return JSON.parse(jsonMatch[0]);
		} else {
			throw new Error('Invalid JSON response from AI when determining target website');
		}
	} catch (error) {
		console.error('Error determining target website:', error);
		throw error;
	}
}

async function generateSmartSelectors(userQuery, pageContent, attempt = 1) {
	const config = {
		thinkingConfig: {
			thinkingBudget: 0
		}
	};

	const model = 'gemini-2.5-flash';

	let prompt = '';

	if (attempt === 1) {
		// Initial attempt with user query only
		prompt = `
            Parse this web scraping request and generate CSS selectors:
            "${userQuery}"
            
            Analyze the request and determine:
            1. What data elements need to be extracted
            2. The most likely CSS selectors for those elements
            3. How many items to extract
            
            Respond with JSON only:
            {
                "elements": {
                    "name": "selector1, selector2, selector3",
                    "price": "selector1, selector2, selector3",
                    "rating": "selector1, selector2, selector3"
                },
                "maxItems": 20,
                "containers": ["selector1", "selector2", "selector3"]
            }
        `;
	} else {
		// Subsequent attempts with page content analysis
		prompt = `
            PREVIOUS SELECTORS FAILED. Analyze this HTML content and generate NEW selectors:
            
            Original request: "${userQuery}"
            HTML Sample: "${pageContent}"
            Attempt: ${attempt}
            
            Carefully examine the HTML structure and identify:
            1. Container elements that hold product/item data
            2. Elements within containers that contain names/titles
            3. Elements that contain prices/costs
            4. Elements that contain ratings/reviews
            
            For e-commerce sites like Tjori, Shopify stores often use patterns like:
            - Product names: h3 a, .product-title, .product-name, .card-title, .item-title
            - Prices: .money, .price, .price-item, .product-price, span[class*="price"]
            - Ratings: .rating, .stars, .review, [class*="star"], [class*="rating"]
            - Containers: .product-item, .grid-item, .product-card, .collection-item
            
            Generate completely DIFFERENT selectors from what might have been tried before.
            Look for:
            - Class names with product, item, card, listing in them
            - Data attributes
            - Specific HTML structures
            - Alternative selector patterns
            - Nested selectors like "div.container h3 a"
            
            Respond with JSON only:
            {
                "elements": {
                    "name": "h3 a, .product-title a, [class*='title'] a, .card-title",
                    "price": ".money, .price, [class*='price'], .cost, .amount", 
                    "rating": ".rating, .stars, [class*='rating'], [class*='star'], .review"
                },
                "maxItems": 20,
                "containers": [".product-item", ".grid-item", ".product-card", ".collection-item"]
            }
        `;
	}

	const contents = [
		{
			role: 'user',
			parts: [{ text: prompt }]
		}
	];

	try {
		const response = await ai.models.generateContentStream({
			model,
			config,
			contents
		});

		let result = '';
		for await (const chunk of response) {
			result += chunk.text;
		}

		const jsonMatch = result.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			return JSON.parse(jsonMatch[0]);
		} else {
			throw new Error('Invalid JSON response from AI');
		}
	} catch (error) {
		console.error('Error generating selectors:', error);
		throw error;
	}
}

async function testSelectors(page, selectors) {
	return await page.evaluate((selectors) => {
		const results = {
			containersFound: 0,
			dataExtracted: [],
			debugInfo: {}
		};

		// Test container selectors
		let containers = [];
		for (const containerSelector of selectors.containers) {
			try {
				const elements = document.querySelectorAll(containerSelector.trim());
				if (elements.length > 0) {
					containers = Array.from(elements);
					results.containersFound = containers.length;
					results.debugInfo.workingContainerSelector = containerSelector;
					break;
				}
			} catch (e) {
				results.debugInfo[`container_error_${containerSelector}`] = e.message;
			}
		}

		// If no containers found, try to find any potential containers
		if (containers.length === 0) {
			const fallbackSelectors = [
				'[class*="product"]',
				'[class*="item"]',
				'[class*="card"]',
				'.grid > *',
				'.collection > *',
				'.listing > *',
				'li',
				'article',
				'.entry'
			];

			for (const fallback of fallbackSelectors) {
				try {
					const elements = document.querySelectorAll(fallback);
					if (elements.length > 3) {
						// Need at least a few items
						containers = Array.from(elements).slice(0, 20);
						results.containersFound = containers.length;
						results.debugInfo.fallbackContainerSelector = fallback;
						break;
					}
				} catch (e) {}
			}
		}

		// Test data extraction from first few containers
		const maxTest = Math.min(3, containers.length);
		for (let i = 0; i < maxTest; i++) {
			const container = containers[i];
			const item = {};

			for (const [key, selectorString] of Object.entries(selectors.elements)) {
				const selectorList = selectorString.split(',').map((s) => s.trim());
				let found = false;

				for (const selector of selectorList) {
					try {
						const element = container.querySelector(selector);
						if (element && element.textContent?.trim()) {
							item[key] = element.textContent.trim().substring(0, 100); // Limit length
							found = true;
							results.debugInfo[`${key}_working_selector`] = selector;
							break;
						}
					} catch (e) {
						results.debugInfo[`${key}_error_${selector}`] = e.message;
					}
				}

				// Enhanced fallback search with more aggressive selector patterns
				if (!found) {
					let fallbackSelectors = [];

					if (key.toLowerCase().includes('name') || key.toLowerCase().includes('title')) {
						fallbackSelectors = [
							'h1',
							'h2',
							'h3',
							'h4',
							'h5',
							'h6',
							'.title',
							'.name',
							'.product-title',
							'.product-name',
							'[class*="title"]',
							'[class*="name"]',
							'[class*="product"]',
							'a[href*="product"]',
							'a[href*="item"]',
							'.card-title',
							'.item-title',
							'.heading',
							'span[class*="title"]',
							'div[class*="title"]'
						];
					} else if (key.toLowerCase().includes('price')) {
						fallbackSelectors = [
							'.price',
							'.cost',
							'.amount',
							'.money',
							'.currency',
							'[class*="price"]',
							'[class*="cost"]',
							'[class*="money"]',
							'.product-price',
							'.item-price',
							'.sale-price',
							'[data-price]',
							'span[class*="price"]',
							'div[class*="price"]',
							'.price-current',
							'.price-new'
						];
					} else if (key.toLowerCase().includes('rating') || key.toLowerCase().includes('star')) {
						fallbackSelectors = [
							'.rating',
							'.stars',
							'.score',
							'.review',
							'[class*="rating"]',
							'[class*="star"]',
							'[class*="review"]',
							'.product-rating',
							'.item-rating',
							'.star-rating',
							'[data-rating]',
							'[aria-label*="star"]',
							'span[class*="rating"]',
							'div[class*="star"]'
						];
					}

					for (const fallback of fallbackSelectors) {
						try {
							const element = container.querySelector(fallback);
							if (element && element.textContent?.trim()) {
								item[key] = element.textContent.trim().substring(0, 100);
								found = true;
								results.debugInfo[`${key}_fallback_selector`] = fallback;
								break;
							}
						} catch (e) {}
					}
				}

				if (!found) {
					item[key] = '';
				}
			}

			results.dataExtracted.push(item);
		}

		// Calculate success rate
		const totalFields = Object.keys(selectors.elements).length;
		const successfulExtractions = results.dataExtracted.reduce((acc, item) => {
			const filledFields = Object.values(item).filter((val) => val && val.length > 0).length;
			return acc + filledFields / totalFields;
		}, 0);

		results.successRate =
			results.dataExtracted.length > 0 ? successfulExtractions / results.dataExtracted.length : 0;

		return results;
	}, selectors);
}

async function getPageSample(page) {
	return await page.evaluate(() => {
		// Get a sample of the page HTML structure
		const body = document.body;
		const sample = {
			title: document.title,
			url: window.location.href,
			bodyClasses: body.className,
			structure: []
		};

		// Get key structural elements
		const selectors = [
			'main',
			'section',
			'article',
			'div[class*="product"]',
			'div[class*="item"]',
			'div[class*="card"]',
			'div[class*="grid"]',
			'div[class*="collection"]',
			'div[class*="listing"]',
			'ul',
			'ol'
		];

		for (const selector of selectors) {
			try {
				const elements = document.querySelectorAll(selector);
				if (elements.length > 0) {
					const first = elements[0];
					sample.structure.push({
						selector: selector,
						count: elements.length,
						className: first.className,
						innerHTML: first.innerHTML.substring(0, 300) + '...'
					});
				}
			} catch (e) {}
		}

		return sample;
	});
}

async function bulkExtractAndExport(selectors, url) {
	const browser = await puppeteer.launch({
		headless: true,
		args: ['--no-sandbox', '--disable-setuid-sandbox']
	});

	try {
		const page = await browser.newPage();
		await page.setUserAgent(
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
		);

		console.log('🌐 Navigating to:', url);
		await page.goto(url, {
			waitUntil: 'networkidle2',
			timeout: 30000
		});

		await new Promise((resolve) => setTimeout(resolve, 3000));

		// Extract ALL available data using the proven selectors
		const allData = await page.evaluate((selectors) => {
			const results = [];

			// Find containers using the working selectors
			let containers = [];
			for (const containerSelector of selectors.containers) {
				try {
					const elements = document.querySelectorAll(containerSelector.trim());
					if (elements.length > 0) {
						containers = Array.from(elements);
						console.log(`Found ${containers.length} containers for bulk extraction`);
						break;
					}
				} catch (e) {}
			}

			// Fallback container search
			if (containers.length === 0) {
				const fallbacks = [
					'[class*="product"]',
					'[class*="item"]',
					'[class*="card"]',
					'li',
					'article'
				];
				for (const fallback of fallbacks) {
					try {
						const elements = document.querySelectorAll(fallback);
						if (elements.length > 3) {
							containers = Array.from(elements);
							console.log(`Found ${containers.length} containers using fallback: ${fallback}`);
							break;
						}
					} catch (e) {}
				}
			}

			// Extract data from ALL containers (no limit)
			for (let i = 0; i < containers.length; i++) {
				const container = containers[i];
				const item = {};

				for (const [key, selectorString] of Object.entries(selectors.elements)) {
					const selectorList = selectorString.split(',').map((s) => s.trim());
					let value = '';

					for (const selector of selectorList) {
						try {
							const element = container.querySelector(selector);
							if (element && element.textContent?.trim()) {
								value = element.textContent.trim();
								break;
							}
						} catch (e) {}
					}

					// Enhanced fallback search for bulk extraction
					if (!value) {
						let fallbackSelectors = [];

						if (key.toLowerCase().includes('name') || key.toLowerCase().includes('title')) {
							fallbackSelectors = [
								'h1',
								'h2',
								'h3',
								'h4',
								'h5',
								'h6',
								'.title',
								'.name',
								'.product-title',
								'.product-name',
								'[class*="title"]',
								'[class*="name"]',
								'[class*="product"]',
								'a[href*="product"]',
								'a[href*="item"]',
								'.card-title',
								'.item-title',
								'.heading',
								'span[class*="title"]',
								'div[class*="title"]'
							];
						} else if (key.toLowerCase().includes('price')) {
							fallbackSelectors = [
								'.price',
								'.cost',
								'.amount',
								'.money',
								'.currency',
								'[class*="price"]',
								'[class*="cost"]',
								'[class*="money"]',
								'.product-price',
								'.item-price',
								'.sale-price',
								'[data-price]',
								'span[class*="price"]',
								'div[class*="price"]',
								'.price-current',
								'.price-new'
							];
						} else if (key.toLowerCase().includes('rating') || key.toLowerCase().includes('star')) {
							fallbackSelectors = [
								'.rating',
								'.stars',
								'.score',
								'.review',
								'[class*="rating"]',
								'[class*="star"]',
								'[class*="review"]',
								'.product-rating',
								'.item-rating',
								'.star-rating',
								'[data-rating]',
								'[aria-label*="star"]',
								'span[class*="rating"]',
								'div[class*="star"]'
							];
						}

						for (const fallback of fallbackSelectors) {
							try {
								const element = container.querySelector(fallback);
								if (element && element.textContent?.trim()) {
									value = element.textContent.trim();
									break;
								}
							} catch (e) {}
						}
					}

					item[key] = value || '';
				}

				// Add item even if some fields are empty (for comprehensive export)
				if (Object.values(item).some((v) => v && v.length > 0)) {
					results.push(item);
				}
			}

			console.log(`Bulk extraction completed: ${results.length} items found`);
			return results;
		}, selectors);

		return allData;
	} finally {
		await browser.close();
	}
}

function convertToCSV(data) {
	if (!data || data.length === 0) {
		return '';
	}

	// Get all unique headers from all objects
	const headers = [...new Set(data.flatMap((obj) => Object.keys(obj)))];

	// Create CSV header row
	const csvHeader = headers.map((header) => `"${header}"`).join(',');

	// Create CSV data rows
	const csvRows = data.map((row) => {
		return headers
			.map((header) => {
				const value = row[header] || '';
				// Escape quotes and wrap in quotes
				const escapedValue = value.toString().replace(/"/g, '""');
				return `"${escapedValue}"`;
			})
			.join(',');
	});

	return [csvHeader, ...csvRows].join('\n');
}

async function intelligentScrape(userQuery) {
	const browser = await puppeteer.launch({
		headless: true,
		args: ['--no-sandbox', '--disable-setuid-sandbox']
	});

	try {
		const page = await browser.newPage();
		await page.setUserAgent(
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
		);

		// First, determine the target website if URL is not provided
		let url = '';
		const urlMatch = userQuery.match(/https?:\/\/[^\s]+/);

		if (urlMatch) {
			// URL is provided in the query
			url = urlMatch[0];
			console.log('🔗 URL found in query:', url);
		} else {
			// No URL provided, ask AI to determine target website
			console.log('🤖 No URL provided, determining target website...');
			const websiteInfo = await determineTargetWebsite(userQuery);
			url = websiteInfo.url;
			console.log('🎯 AI determined target website:', url);
			console.log('📝 Reasoning:', websiteInfo.reasoning);
		}

		console.log('🌐 Navigating to:', url);
		await page.goto(url, {
			waitUntil: 'networkidle2',
			timeout: 30000
		});

		await new Promise((resolve) => setTimeout(resolve, 3000));

		const maxAttempts = 3;
		let bestResult = { data: [], successRate: 0, attempt: 0 };

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			console.log(`🤖 AI Agent Attempt ${attempt}/${maxAttempts}`);

			try {
				let pageContent = '';

				if (attempt > 1) {
					// Get page sample for AI to analyze
					console.log('📄 Analyzing page structure...');
					const pageSample = await getPageSample(page);
					pageContent = JSON.stringify(pageSample, null, 2);
					console.log(
						'Page sample extracted:',
						pageSample.structure.length,
						'structural elements found'
					);
				}

				// Generate selectors using AI
				console.log('🧠 Generating CSS selectors...');
				const selectors = await generateSmartSelectors(userQuery, pageContent, attempt);
				console.log('Generated selectors:', selectors);

				// Test the selectors
				console.log('🧪 Testing selectors...');
				const testResult = await testSelectors(page, selectors);
				console.log('Test result:', testResult);

				if (testResult.successRate > bestResult.successRate) {
					bestResult = {
						data: testResult.dataExtracted,
						successRate: testResult.successRate,
						attempt: attempt,
						selectors: selectors,
						debugInfo: testResult.debugInfo,
						containersFound: testResult.containersFound
					};
				}

				// If we got a good success rate, extract full data
				if (testResult.successRate >= 0.25) {
					// Lowered threshold to 25% to be more permissive
					console.log(
						`✅ Acceptable selectors found (${(testResult.successRate * 100).toFixed(1)}%)! Extracting full data...`
					);

					const fullData = await page.evaluate((selectors) => {
						const results = [];
						const maxItems = selectors.maxItems || 20;

						// Find containers
						let containers = [];
						for (const containerSelector of selectors.containers) {
							try {
								const elements = document.querySelectorAll(containerSelector.trim());
								if (elements.length > 0) {
									containers = Array.from(elements);
									break;
								}
							} catch (e) {}
						}

						// Fallback container search
						if (containers.length === 0) {
							const fallbacks = [
								'[class*="product"]',
								'[class*="item"]',
								'[class*="card"]',
								'li',
								'article'
							];
							for (const fallback of fallbacks) {
								try {
									const elements = document.querySelectorAll(fallback);
									if (elements.length > 3) {
										containers = Array.from(elements);
										break;
									}
								} catch (e) {}
							}
						}

						// Extract data from all containers
						for (let i = 0; i < Math.min(containers.length, maxItems); i++) {
							const container = containers[i];
							const item = {};

							for (const [key, selectorString] of Object.entries(selectors.elements)) {
								const selectorList = selectorString.split(',').map((s) => s.trim());
								let value = '';

								for (const selector of selectorList) {
									try {
										const element = container.querySelector(selector);
										if (element && element.textContent?.trim()) {
											value = element.textContent.trim();
											break;
										}
									} catch (e) {}
								}

								// Enhanced fallback search for full extraction
								if (!value) {
									let fallbackSelectors = [];

									if (key.toLowerCase().includes('name') || key.toLowerCase().includes('title')) {
										fallbackSelectors = [
											'h1',
											'h2',
											'h3',
											'h4',
											'h5',
											'h6',
											'.title',
											'.name',
											'.product-title',
											'.product-name',
											'[class*="title"]',
											'[class*="name"]',
											'[class*="product"]',
											'a[href*="product"]',
											'a[href*="item"]',
											'.card-title',
											'.item-title',
											'.heading',
											'span[class*="title"]',
											'div[class*="title"]'
										];
									} else if (key.toLowerCase().includes('price')) {
										fallbackSelectors = [
											'.price',
											'.cost',
											'.amount',
											'.money',
											'.currency',
											'[class*="price"]',
											'[class*="cost"]',
											'[class*="money"]',
											'.product-price',
											'.item-price',
											'.sale-price',
											'[data-price]',
											'span[class*="price"]',
											'div[class*="price"]',
											'.price-current',
											'.price-new'
										];
									} else if (
										key.toLowerCase().includes('rating') ||
										key.toLowerCase().includes('star')
									) {
										fallbackSelectors = [
											'.rating',
											'.stars',
											'.score',
											'.review',
											'[class*="rating"]',
											'[class*="star"]',
											'[class*="review"]',
											'.product-rating',
											'.item-rating',
											'.star-rating',
											'[data-rating]',
											'[aria-label*="star"]',
											'span[class*="rating"]',
											'div[class*="star"]'
										];
									}

									for (const fallback of fallbackSelectors) {
										try {
											const element = container.querySelector(fallback);
											if (element && element.textContent?.trim()) {
												value = element.textContent.trim();
												break;
											}
										} catch (e) {}
									}
								}

								item[key] = value;
							}

							// Only add items with at least one field filled
							if (Object.values(item).some((v) => v && v.length > 0)) {
								results.push(item);
							}
						}

						return results;
					}, selectors);

					return {
						success: true,
						data: fullData,
						count: fullData.length,
						aiAgent: {
							attemptsUsed: attempt,
							finalSuccessRate: testResult.successRate,
							selectorsUsed: selectors,
							debugInfo: testResult.debugInfo
						},
						url: url
					};
				}

				// If not successful enough, continue to next attempt
				console.log(
					`❌ Success rate too low (${(testResult.successRate * 100).toFixed(1)}%), trying again...`
				);
			} catch (error) {
				console.error(`Error in attempt ${attempt}:`, error);
			}
		}

		// If we exhausted all attempts, return the best result we got
		console.log('🏁 All attempts completed. Best result:', bestResult);

		return {
			success: bestResult.data.length > 0,
			data: bestResult.data,
			count: bestResult.data.length,
			aiAgent: {
				attemptsUsed: maxAttempts,
				finalSuccessRate: bestResult.successRate,
				selectorsUsed: bestResult.selectors,
				debugInfo: bestResult.debugInfo,
				message:
					bestResult.data.length > 0
						? `Found ${bestResult.data.length} items with ${(bestResult.successRate * 100).toFixed(1)}% success rate`
						: 'AI agent could not find suitable selectors. The website structure might be complex or protected.'
			},
			url: url
		};
	} finally {
		await browser.close();
	}
}

export async function POST({ request }) {
	try {
		const body = await request.json();
		const { query, action, selectors, url } = body;

		if (!GEMINI_API_KEY) {
			return json({ error: 'GEMINI_API_KEY is not configured' }, { status: 500 });
		}

		// Handle bulk export action
		if (action === 'export') {
			if (!selectors || !url) {
				return json({ error: 'Selectors and URL are required for export' }, { status: 400 });
			}

			console.log('📊 Starting bulk extraction for CSV export...');
			const allData = await bulkExtractAndExport(selectors, url);

			if (allData.length === 0) {
				return json({ error: 'No data found for export' }, { status: 400 });
			}

			const csvContent = convertToCSV(allData);
			const timestamp = new Date().toISOString().split('T')[0];
			const filename = `scraped-data-${timestamp}.csv`;

			console.log(`✅ Bulk extraction completed: ${allData.length} items exported`);

			return new Response(csvContent, {
				headers: {
					'Content-Type': 'text/csv',
					'Content-Disposition': `attachment; filename="${filename}"`
				}
			});
		}

		// Handle normal scraping action
		if (!query) {
			return json({ error: 'Query is required' }, { status: 400 });
		}

		console.log('🚀 Starting intelligent scraping for:', query);

		// Use the intelligent AI agent scraper
		const result = await intelligentScrape(query);

		console.log('🏁 Scraping completed:', result);

		if (result.success) {
			return json({
				success: true,
				data: result.data,
				count: result.count,
				url: result.url,
				aiAgent: result.aiAgent
			});
		} else {
			return json(
				{
					error: 'Could not extract data from the website',
					details: result.aiAgent?.message || 'AI agent exhausted all attempts',
					aiAgent: result.aiAgent
				},
				{ status: 400 }
			);
		}
	} catch (error) {
		console.error('❌ Scraping error:', error);
		return json(
			{
				error: error.message || 'An error occurred during scraping',
				details: error.toString()
			},
			{ status: 500 }
		);
	}
}
